import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch } from '@/lib/github-api';

const TOKENS_FILE = 'app/globals.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenRow {
  name:   string;           // e.g. "--primary"
  group:  string;           // e.g. "Brand palette"
  type:   'color' | 'size' | 'other';
  modes:  Record<string, string>;  // mode name → raw CSS value (empty string = unset)
}

export interface TokenCollection {
  modes:  string[];         // ordered mode names, first is "default"
  groups: string[];         // ordered group names
  tokens: TokenRow[];
}

// ── CSS parser — extracts :root{} and .modeName{} blocks ──────────────────────

function detectType(name: string, value: string): 'color' | 'size' | 'other' {
  if (/^(#|rgb|hsl|oklch|oklab|lch|color)/.test(value)) return 'color';
  if (name.includes('color') || name.includes('bg') || name.includes('foreground') ||
      name.includes('border') || name.includes('ring') || name.includes('primary') ||
      name.includes('secondary') || name.includes('muted') || name.includes('accent') ||
      name.includes('destructive') || name.includes('popover') || name.includes('card') ||
      name.includes('sidebar') || name.includes('chart') || name.includes('background')) return 'color';
  if (/px$|rem$|em$/.test(value) || name.includes('radius') || name.includes('spacing') ||
      name.includes('size') || name.includes('font-size')) return 'size';
  return 'other';
}

function parseAllBlocks(css: string): {
  rootTokens: Map<string, { value: string; group: string }>;
  modeBlocks: Map<string, Map<string, string>>;
  modeOrder:  string[];
} {
  const rootTokens = new Map<string, { value: string; group: string }>();
  const modeBlocks = new Map<string, Map<string, string>>();
  const modeOrder: string[] = [];

  const lines = css.split('\n');
  let braceDepth = 0;
  let currentSelector = '';
  let currentGroup = 'Other';

  const groupComment = /\/\*[─\s]*([^─*]+?)\s*[─\s]*\*\//;

  for (const line of lines) {
    const opens  = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (opens > 0 && braceDepth === 0) {
      currentSelector = line.trim().replace(/\s*\{.*/, '').trim();
    }

    braceDepth += opens;

    // Parse content inside a block
    if (braceDepth === 1) {
      const commentMatch = line.match(groupComment);
      if (commentMatch) {
        currentGroup = commentMatch[1].trim().replace(/^Color\s*\|\s*/, '')
          .replace(/^Spacing\s*\|\s*/, '').replace(/^Component\s*\|\s*/, '')
          .replace(/^Typography\s*[—–-]\s*/i, '').trim() || 'Other';
      }
      const propMatch = line.match(/^\s*(--[\w.-]+)\s*:\s*([^;]+);/);
      if (propMatch) {
        const [, name, value] = propMatch;
        if (currentSelector === ':root') {
          rootTokens.set(name, { value: value.trim(), group: currentGroup });
        } else if (currentSelector && !currentSelector.startsWith('@') &&
                   !currentSelector.startsWith(':root') &&
                   !currentSelector.includes(' ')) {
          // named mode block e.g. ".dark"
          const modeName = currentSelector.replace(/^\./, '');
          if (!modeBlocks.has(modeName)) {
            modeBlocks.set(modeName, new Map());
            modeOrder.push(modeName);
          }
          modeBlocks.get(modeName)!.set(name, value.trim());
        }
      }
    }

    braceDepth -= closes;
    if (braceDepth <= 0) {
      braceDepth = 0;
      if (closes > 0) currentGroup = 'Other';
    }
  }

  return { rootTokens, modeBlocks, modeOrder };
}

function buildCollection(css: string): TokenCollection {
  const { rootTokens, modeBlocks, modeOrder } = parseAllBlocks(css);

  const modes = ['default', ...modeOrder];
  const groupOrder: string[] = [];
  const groupSet = new Set<string>();

  for (const { group } of rootTokens.values()) {
    if (!groupSet.has(group)) { groupSet.add(group); groupOrder.push(group); }
  }

  const tokens: TokenRow[] = [];
  for (const [name, { value, group }] of rootTokens) {
    const modeValues: Record<string, string> = { default: value };
    for (const mode of modeOrder) {
      modeValues[mode] = modeBlocks.get(mode)?.get(name) ?? '';
    }
    tokens.push({
      name,
      group,
      type: detectType(name, value),
      modes: modeValues,
    });
  }

  return { modes, groups: groupOrder, tokens };
}

// ── CSS writer — patches :root and mode blocks in-place ───────────────────────

function patchCss(
  css: string,
  changes: Array<{ name: string; mode: string; value: string }>,
  newModes: string[],
): string {
  let result = css;

  for (const { name, mode, value } of changes) {
    if (mode === 'default') {
      // Patch inside :root {}
      const re = new RegExp(`(:root\\s*\\{[^}]*?)(${escRe(name)}\\s*:\\s*)([^;]+)(;)`, 's');
      if (re.test(result)) {
        result = result.replace(re, `$1$2${value}$4`);
      } else {
        result = result.replace(/(:root\s*\{)/, `$1\n  ${name}: ${value};`);
      }
    } else {
      const selector = `.${mode}`;
      const blockRe = new RegExp(`(${escRe(selector)}\\s*\\{)([^}]*)(\\})`, 's');
      const blockMatch = blockRe.exec(result);
      if (blockMatch) {
        const inner = blockMatch[2];
        const propRe = new RegExp(`(${escRe(name)}\\s*:\\s*)([^;]+)(;)`);
        if (propRe.test(inner)) {
          result = result.replace(blockRe, `$1${inner.replace(propRe, `$1${value}$3`)}$3`);
        } else {
          result = result.replace(blockRe, `$1${inner}  ${name}: ${value};\n$3`);
        }
      } else if (value) {
        // Create new mode block at end of file (before last @layer if present)
        const insertBefore = result.lastIndexOf('@layer');
        const block = `\n${selector} {\n  ${name}: ${value};\n}\n`;
        if (insertBefore > -1) {
          result = result.slice(0, insertBefore) + block + result.slice(insertBefore);
        } else {
          result += block;
        }
      }
    }
  }

  // Add skeleton blocks for brand-new modes
  for (const mode of newModes) {
    const selector = `.${mode.toLowerCase().replace(/\s+/g, '-')}`;
    if (!result.includes(`${selector} {`)) {
      result += `\n${selector} {\n  /* ${mode} mode */\n}\n`;
    }
  }

  return result;
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const { content } = await getFile(TOKENS_FILE);
    return NextResponse.json(buildCollection(content));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      changes:  Array<{ name: string; mode: string; value: string }>;
      newModes?: string[];
    };
    const { changes, newModes = [] } = body;

    const branch = workingBranch();
    await ensureBranch(branch);

    const { content, sha } = await getFile(TOKENS_FILE, branch);
    const updated = patchCss(content, changes, newModes);

    await putFile(TOKENS_FILE, updated, `design: update tokens (${changes.length} change${changes.length !== 1 ? 's' : ''})`, sha, branch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
