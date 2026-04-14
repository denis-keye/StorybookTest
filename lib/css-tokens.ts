// CSS token parsing and patching utilities — shared between the Vite dev plugin
// and the Vercel API routes so the logic is never duplicated.

export interface TokenEntry {
  name:     string;
  raw:      string;
  resolved: string;
  group:    string;
  type:     'color' | 'size' | 'shadow' | 'font' | 'other';
}

// ─── Color conversion: oklch → hex ────────────────────────────────────────────

function gammaEncode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function oklchToHex(oklchStr: string): string | null {
  const m = oklchStr.match(
    /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (!m) return null;

  const parseVal = (s: string, pctMax = 1) =>
    s.endsWith('%') ? (parseFloat(s) / 100) * pctMax : parseFloat(s);

  const L = parseVal(m[1]);
  const C = parseVal(m[2]);
  const H = parseFloat(m[3]);

  const hRad = (H * Math.PI) / 180;
  const a    = C * Math.cos(hRad);
  const b    = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const ll = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const ss = s_ * s_ * s_;

  const R = +4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
  const G = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
  const B = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss;

  const toU8 = (c: number) =>
    Math.max(0, Math.min(255, Math.round(gammaEncode(c) * 255)));

  const r = toU8(R), g = toU8(G), bl = toU8(B);
  return '#' + [r, g, bl].map(n => n.toString(16).padStart(2, '0')).join('');
}

// ─── Parser ────────────────────────────────────────────────────────────────────

export function parseTokens(css: string): TokenEntry[] {
  const lines = css.split('\n');
  const raw    = new Map<string, string>();
  const groups = new Map<string, string>();

  let currentGroup = 'Other';
  const groupComment = /\/\*[─\s]*([^─*]+?)\s*[─\s]*\*\//;

  let braceDepth  = 0;
  let inRootBlock = false;
  let skipBlock   = false;

  for (const line of lines) {
    const opens  = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (opens > 0) {
      const trimmed = line.trim();
      if (braceDepth === 0) {
        if (trimmed.startsWith(':root')) {
          inRootBlock = true;
          skipBlock   = false;
        } else {
          inRootBlock = false;
          skipBlock   = true;
        }
      }
      braceDepth += opens;
    }

    if (closes > 0) {
      braceDepth -= closes;
      if (braceDepth <= 0) {
        braceDepth  = 0;
        inRootBlock = false;
        skipBlock   = false;
      }
    }

    if (!inRootBlock) continue;

    const commentMatch = line.match(groupComment);
    if (commentMatch) {
      const label = commentMatch[1].trim()
        .replace(/^Color\s*\|\s*L[0-9]\s*[—–-]\s*/i, '')
        .replace(/^Spacing\s*\|\s*L[0-9]\s*[—–-]\s*/i, '')
        .replace(/^Component\s*\|\s*L[0-9]\s*[—–-]\s*/i, '')
        .replace(/^Typography\s*[—–-]\s*/i, '')
        .trim();
      if (label) currentGroup = label;
      continue;
    }
    const propMatch = line.match(/^\s*(--[\w.-]+)\s*:\s*([^;]+);/);
    if (propMatch) {
      const [, name, value] = propMatch;
      raw.set(name, value.trim());
      groups.set(name, currentGroup);
    }
  }

  const resolved = new Map<string, string>();
  for (const [name, value] of raw) {
    if (!value.includes('var(')) {
      // Skip oklch conversion — server-side math is inaccurate for display.
      // Browser resolution via DESIGN/RESOLVE_TOKENS will patch with correct values.
      if (!value.startsWith('oklch(')) {
        resolved.set(name, value);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, value] of raw) {
      if (resolved.has(name)) continue;
      const m = value.match(/^var\(--([\w.-]+)\)/);
      if (m) {
        const ref = resolved.get(`--${m[1]}`);
        if (ref !== undefined) { resolved.set(name, ref); changed = true; }
      }
    }
  }

  const entries: TokenEntry[] = [];
  for (const [name, rawValue] of raw) {
    const res      = resolved.get(name) ?? rawValue;
    const isColor  = /^(#|rgb|hsl|oklch|oklab|lch|var)/.test(rawValue) || rawValue === '#ffffff' || rawValue === '#000000';
    const isSize   = /px$/.test(res) || /rem$/.test(res) || /^\d/.test(res);
    const isShadow = rawValue.includes('rgb(') && rawValue.includes('px');
    const isFont   = name.startsWith('--font');
    entries.push({
      name,
      raw:      rawValue,
      resolved: res,
      group:    groups.get(name) ?? 'Other',
      type:     isShadow ? 'shadow' : isFont ? 'font' : isColor ? 'color' : isSize ? 'size' : 'other',
    });
  }
  return entries;
}

// ─── Updater ───────────────────────────────────────────────────────────────────

export function updateTokenInCss(css: string, name: string, newValue: string): string {
  const escaped = name.replace(/\./g, '\\.').replace(/-/g, '\\-');
  const regex   = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g');
  if (!regex.test(css)) return css;
  return css.replace(new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g'),
    `$1${newValue}$3`);
}

// ─── Story file helpers ────────────────────────────────────────────────────────

/** "components-button--text-icon" → "TextIcon" */
export function storyExportName(storyId: string): string {
  const part = storyId.split('--')[1] ?? '';
  return part.split('-').map(w => w[0]?.toUpperCase() + w.slice(1)).join('');
}

/** Patch `prop: 'oldValue'` inside the named story export's args block. */
export function patchStoryArg(src: string, exportName: string, prop: string, newValue: string): string | null {
  const exportIdx = src.indexOf(`export const ${exportName}`);
  if (exportIdx === -1) return null;

  const fromExport = src.slice(exportIdx);
  const argsMatch  = fromExport.match(/\bargs\s*:/);
  if (!argsMatch) return null;

  const argsStart  = exportIdx + argsMatch.index!;
  const braceOpen  = src.indexOf('{', argsStart + 5);
  if (braceOpen === -1) return null;

  let depth = 0, braceClose = -1;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { braceClose = i; break; } }
  }
  if (braceClose === -1) return null;

  const before = src.slice(0, braceOpen + 1);
  let   block  = src.slice(braceOpen + 1, braceClose);
  const after  = src.slice(braceClose);

  const esc  = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safe = newValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const re   = new RegExp(`(\\b${esc}\\s*:\\s*)(['"])[^'"]*\\2`);

  if (re.test(block)) {
    block = block.replace(re, `$1'${safe}'`);
  } else {
    const indent = block.match(/\n(\s+)/)?.[1] ?? '    ';
    block = `\n${indent}${prop}: '${safe}',` + block;
  }

  return before + block + after;
}
