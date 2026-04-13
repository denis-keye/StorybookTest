import type { Plugin } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(process.cwd(), 'components');
const TOKENS_FILE    = path.resolve(process.cwd(), 'app/globals.css');
const STORIES_DIR    = path.resolve(process.cwd(), 'stories');

// ─── Story-file helpers ───────────────────────────────────────────────────────

/** Recursively collect all *.stories.{tsx,ts,jsx,js} files under a directory */
async function collectStoryFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectStoryFiles(full));
    } else if (/\.stories\.(tsx?|jsx?)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** "components-button--fill" → absolute path to Button.stories.tsx (or null) */
async function findStoryFile(storyId: string): Promise<string | null> {
  // "components-button--fill"  → "button"
  const componentPart = storyId.split('--')[0]
    .replace(/^components?-/, '')
    .replace(/-/g, '');                          // e.g. "contentsactionrow"

  // Search both stories/ and components/**/
  const allFiles = [
    ...await collectStoryFiles(STORIES_DIR),
    ...await collectStoryFiles(COMPONENTS_DIR),
  ];

  for (const filePath of allFiles) {
    const file = path.basename(filePath);
    const normalized = file.replace(/\.stories\.(tsx?|jsx?)$/, '').toLowerCase().replace(/-/g, '');
    if (normalized === componentPart) return filePath;
  }
  return null;
}

/** "components-button--text-icon" → "TextIcon" */
function storyExportName(storyId: string): string {
  const part = storyId.split('--')[1] ?? '';
  return part.split('-').map(w => w[0]?.toUpperCase() + w.slice(1)).join('');
}

/** Patch `prop: 'oldValue'` inside the named story export's args block. */
function patchStoryArg(src: string, exportName: string, prop: string, newValue: string): string | null {
  const exportIdx = src.indexOf(`export const ${exportName}`);
  if (exportIdx === -1) return null;

  // Locate the args: { ... } block inside this export
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

  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safe = newValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const re   = new RegExp(`(\\b${esc}\\s*:\\s*)(['"])[^'"]*\\2`);

  if (re.test(block)) {
    block = block.replace(re, `$1'${safe}'`);
  } else {
    // prop absent → insert it
    const indent = block.match(/\n(\s+)/)?.[1] ?? '    ';
    block = `\n${indent}${prop}: '${safe}',` + block;
  }

  return before + block + after;
}

// ─── CSS custom property parser ────────────────────────────────────────────────

export interface TokenEntry {
  name:     string;   // '--blue-500'
  raw:      string;   // '#3b82f6' or 'var(--zinc-950)'
  resolved: string;   // '#3b82f6' (always a primitive value)
  group:    string;   // 'blue', 'content', 'spacing', etc.
  type:     'color' | 'size' | 'shadow' | 'font' | 'other';
}

function parseTokens(css: string): TokenEntry[] {
  const lines = css.split('\n');
  const raw   = new Map<string, string>();  // name → raw value string
  const groups = new Map<string, string>(); // name → group label

  let currentGroup = 'Other';
  const groupComment = /\/\*[─\s]*([^─*]+?)\s*[─\s]*\*\//;

  for (const line of lines) {
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

  // Build resolved values (iterative var() resolution)
  const resolved = new Map<string, string>();
  for (const [name, value] of raw) {
    if (!value.includes('var(')) resolved.set(name, value);
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
    const res = resolved.get(name) ?? rawValue;
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

function updateTokenInCss(css: string, name: string, newValue: string): string {
  // Escape dots in name for regex
  const escaped = name.replace(/\./g, '\\.').replace(/-/g, '\\-');
  const regex = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g');
  if (!regex.test(css)) return css; // nothing to replace
  return css.replace(new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g'),
    `$1${newValue}$3`);
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export function contextPlugin(): Plugin {
  return {
    name: 'keye-context',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        // ── /api/tokens ────────────────────────────────────────────────────

        if (url.pathname === '/api/tokens') {
          if (req.method === 'GET') {
            try {
              const css    = await fs.readFile(TOKENS_FILE, 'utf-8');
              const tokens = parseTokens(css);
              res.statusCode = 200;
              return res.end(JSON.stringify(tokens));
            } catch (e) {
              res.statusCode = 500;
              return res.end(JSON.stringify({ error: String(e) }));
            }
          }

          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', async () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                  name: string;
                  value: string;
                };
                if (!body.name || body.value === undefined) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ error: 'name + value required' }));
                }
                let css = await fs.readFile(TOKENS_FILE, 'utf-8');
                const updated = updateTokenInCss(css, body.name, body.value);
                if (updated === css) {
                  // Token not found — append it to :root
                  css = css.replace(/(:root\s*{)/, `$1\n  ${body.name}: ${body.value};`);
                  await fs.writeFile(TOKENS_FILE, css);
                } else {
                  await fs.writeFile(TOKENS_FILE, updated);
                }
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(e) }));
              }
            });
            return;
          }
        }

        // ── /api/story-args  POST { storyId, prop, value } ───────────────

        if (url.pathname === '/api/story-args' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            try {
              const { storyId, prop, value } = JSON.parse(Buffer.concat(chunks).toString()) as {
                storyId: string; prop: string; value: string;
              };
              const filePath = await findStoryFile(storyId);
              if (!filePath) {
                res.statusCode = 404;
                return res.end(JSON.stringify({ error: 'Story file not found', storyId }));
              }
              const exportName = storyExportName(storyId);
              let src = await fs.readFile(filePath, 'utf-8');
              const patched = patchStoryArg(src, exportName, prop, value);
              if (!patched) {
                res.statusCode = 422;
                return res.end(JSON.stringify({ error: `Could not find export "${exportName}" in ${filePath}` }));
              }
              await fs.writeFile(filePath, patched);
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, file: path.relative(process.cwd(), filePath) }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }

        // ── /api/context ───────────────────────────────────────────────────

        if (url.pathname === '/api/context') {
          if (req.method === 'GET') {
            const component = url.searchParams.get('component');
            if (!component) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'component param required' }));
            }
            const filePath = path.join(COMPONENTS_DIR, component, `${component}.context.json`);
            try {
              const raw = await fs.readFile(filePath, 'utf-8');
              res.statusCode = 200;
              return res.end(raw);
            } catch {
              res.statusCode = 200;
              return res.end('{}');
            }
          }

          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', async () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                  component: string;
                  data: unknown;
                };
                if (!body.component || !body.data) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ error: 'component + data required' }));
                }
                const filePath = path.join(
                  COMPONENTS_DIR,
                  body.component,
                  `${body.component}.context.json`,
                );
                await fs.writeFile(filePath, JSON.stringify(body.data, null, 2) + '\n');
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(e) }));
              }
            });
            return;
          }
        }

        next();
      });
    },
  };
}
