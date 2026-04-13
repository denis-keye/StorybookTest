import type { Plugin } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

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
  // "ui-button--default"       → segments ["ui","button"]
  // "components-button--fill"  → segments ["components","button"]
  // "components-action-row--x" → segments ["components","action","row"]
  const segments = storyId.split('--')[0].split('-');

  // Build candidates from progressively shorter suffixes
  // e.g. ["ui","button"] → ["uibutton", "button"]
  const candidates: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    candidates.push(segments.slice(i).join(''));
  }

  // Search both stories/ and components/**/
  const allFiles = [
    ...await collectStoryFiles(STORIES_DIR),
    ...await collectStoryFiles(COMPONENTS_DIR),
  ];

  for (const candidate of candidates) {
    for (const filePath of allFiles) {
      const file       = path.basename(filePath);
      const normalized = file.replace(/\.stories\.(tsx?|jsx?)$/, '').toLowerCase().replace(/-/g, '');
      if (normalized === candidate) return filePath;
    }
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

// ─── Color conversion: oklch → hex ────────────────────────────────────────────
// Tailwind v4 stores colors as oklch(L C H) or oklch(L C H / alpha).
// The browser resolves these to rgb(), so the panel's hex-based token matching
// needs an equivalent hex value to compare against getComputedStyle() output.

function gammaEncode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklchToHex(oklchStr: string): string | null {
  // Match: oklch(L C H) or oklch(L C H / A) — values may be decimals or %
  const m = oklchStr.match(
    /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (!m) return null;

  const parseVal = (s: string, pctMax = 1) =>
    s.endsWith('%') ? (parseFloat(s) / 100) * pctMax : parseFloat(s);

  const L = parseVal(m[1]);            // 0-1
  const C = parseVal(m[2]);            // 0-0.4 typically
  const H = parseFloat(m[3]);          // degrees
  // m[4] is alpha — we ignore it for hex matching (assume opaque)

  const hRad = (H * Math.PI) / 180;
  const a    = C * Math.cos(hRad);
  const b    = C * Math.sin(hRad);

  // oklab → linear sRGB  (OKLab paper coefficients)
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

// ─── CSS custom property parser ────────────────────────────────────────────────

export interface TokenEntry {
  name:     string;   // '--blue-500'
  raw:      string;   // 'oklch(0.205 0 0)' or 'var(--zinc-950)'
  resolved: string;   // '#3b82f6' (always a primitive, hex for colors)
  group:    string;   // 'blue', 'content', 'spacing', etc.
  type:     'color' | 'size' | 'shadow' | 'font' | 'other';
}

function parseTokens(css: string): TokenEntry[] {
  const lines = css.split('\n');
  const raw   = new Map<string, string>();  // name → raw value string
  const groups = new Map<string, string>(); // name → group label

  let currentGroup = 'Other';
  const groupComment = /\/\*[─\s]*([^─*]+?)\s*[─\s]*\*\//;

  // Track block depth and whether we're in an editable context.
  // Only collect vars from :root {} — skip @theme inline {}, .dark {}, and any
  // other selector blocks.  We do a simple brace-depth tracker; the block type
  // is identified by the most recent non-empty non-comment line before an `{`.
  let braceDepth   = 0;
  let inRootBlock  = false;  // true while inside :root { … }
  let skipBlock    = false;  // true while inside @theme, .dark, or other blocks

  for (const line of lines) {
    // Count brace transitions
    const opens  = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (opens > 0) {
      // Determine block type from this line (before entering)
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

    // Only process lines inside :root {}
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

  // Build resolved values (iterative var() resolution)
  // After resolving, convert oklch() primitives to hex so the panel's
  // hex-based token-matching (from getComputedStyle) can find a match.
  const resolved = new Map<string, string>();
  for (const [name, value] of raw) {
    if (!value.includes('var(')) {
      const hex = value.startsWith('oklch(') ? (oklchToHex(value) ?? value) : value;
      resolved.set(name, hex);
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

        // ── /api/create-pr  POST { title, body?, branch? } ───────────────

        if (url.pathname === '/api/create-pr' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            const root = process.cwd();
            let originalBranch = 'main';
            let newBranch = '';
            try {
              const { title, body = '', branch: customBranch } = JSON.parse(
                Buffer.concat(chunks).toString(),
              ) as { title: string; body?: string; branch?: string };

              if (!title?.trim()) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'title is required' }));
              }

              // ── Detect changed design files ──────────────────────────────
              const rawDiff = execSync('git diff HEAD --name-only', { cwd: root })
                .toString().trim();
              const changedFiles = rawDiff
                .split('\n')
                .map(f => f.trim())
                .filter(f => f && (f.endsWith('.css') || f.includes('.stories.')));

              if (changedFiles.length === 0) {
                res.statusCode = 400;
                return res.end(JSON.stringify({
                  error: 'No design changes detected. Save some token or story changes first.',
                }));
              }

              // ── GitHub token ─────────────────────────────────────────────
              const token = process.env.GITHUB_TOKEN;
              if (!token) {
                res.statusCode = 400;
                return res.end(JSON.stringify({
                  error: 'GITHUB_TOKEN not set. Add it to your .env.local file.',
                }));
              }

              // ── Detect repo (owner/repo) from remote URL ─────────────────
              const remoteUrl = execSync('git remote get-url origin', { cwd: root })
                .toString().trim();
              const repoMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
              if (!repoMatch) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Could not parse GitHub repo from remote URL' }));
              }
              const repoPath = repoMatch[1]; // "owner/repo"

              // ── Current branch (PR will target this) ─────────────────────
              originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root })
                .toString().trim();

              // ── Create feature branch ────────────────────────────────────
              const ts = Date.now().toString(36);
              newBranch = customBranch?.trim() || `design/${ts}`;
              execSync(`git checkout -b ${newBranch}`, { cwd: root });

              // ── Stage only design files & commit ─────────────────────────
              for (const f of changedFiles) {
                execSync(`git add -- "${f}"`, { cwd: root });
              }
              const safeTitle = title.replace(/"/g, "'").replace(/`/g, "'");
              execSync(`git commit -m "${safeTitle}"`, { cwd: root });

              // ── Push with token auth ─────────────────────────────────────
              // Build an authenticated HTTPS remote URL regardless of whether
              // origin is ssh or https.
              const authRemote = remoteUrl.startsWith('git@')
                ? remoteUrl.replace('git@github.com:', `https://${token}@github.com/`)
                : remoteUrl.replace('https://github.com/', `https://${token}@github.com/`);
              execSync(`git push "${authRemote}" "${newBranch}"`, { cwd: root });

              // ── Create PR via GitHub REST API ────────────────────────────
              const prBody = `${body}\n\n---\n*Created from the Storybook Design Panel*`;
              const apiRes = await fetch(
                `https://api.github.com/repos/${repoPath}/pulls`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `token ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/vnd.github.v3+json',
                  },
                  body: JSON.stringify({
                    title,
                    body: prBody,
                    head: newBranch,
                    base: originalBranch,
                  }),
                },
              );

              if (!apiRes.ok) {
                const err = await apiRes.json() as { message?: string };
                throw new Error(err.message ?? `GitHub API ${apiRes.status}`);
              }

              const pr = await apiRes.json() as { html_url: string; number: number };

              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, url: pr.html_url, branch: newBranch, prNumber: pr.number }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            } finally {
              // Always restore the original branch, even on error
              try { execSync(`git checkout ${originalBranch}`, { cwd: root }); } catch {}
            }
          });
          return;
        }

        next();
      });
    },
  };
}
