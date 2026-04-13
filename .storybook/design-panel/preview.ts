import { addons } from '@storybook/preview-api';
import type { Decorator } from '@storybook/react';

const channel = addons.getChannel();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rgbToHex(rgb: string): string {
  const m = rgb.match(/([\d.]+)/g);
  if (!m || m.length < 3) return rgb;
  return '#' + m.slice(0, 3)
    .map(n => Math.round(parseFloat(n)).toString(16).padStart(2, '0'))
    .join('');
}

/** Extract the local CSS-module class name from a hashed class string.
 *  Vite format:   "_dashboard_wfymv_8"          → "dashboard"
 *                 "_base_cb5di_8 _fill_cb5di_34" → "fill" (last = most specific)
 *  Legacy format: "Button_base__abc"             → "base"
 */
function moduleLocalName(el: Element): string | null {
  const classes = (el.className && typeof el.className === 'string')
    ? el.className.split(/\s+/) : [];

  // Vite CSS module format: _localName_shortHash_lineNumber
  const vite = classes.filter(c => /^_[a-zA-Z]/.test(c) && /^_[^_]+_[a-zA-Z0-9]{4,6}_\d+$/.test(c));
  if (vite.length) {
    const last = vite[vite.length - 1];
    const m = last.match(/^_([^_]+)_[a-zA-Z0-9]+_\d+$/);
    if (m) return m[1];
  }

  // Legacy CRA/webpack format: ComponentName_localClass__hash
  const legacy = classes.filter(c => /__[a-zA-Z0-9]{4,}$/.test(c));
  if (legacy.length) {
    const last = legacy[legacy.length - 1];
    const withoutHash = last.replace(/__[a-zA-Z0-9]+$/, '');
    const parts = withoutHash.split('_');
    return parts.length >= 2 ? parts[parts.length - 1] : parts[0];
  }

  return null;
}

function getLayerName(el: Element): string {
  // 1. Explicit data-layer
  const dl = el.getAttribute('data-layer');
  if (dl) return dl;

  // 2. aria-label (most semantic)
  const al = el.getAttribute('aria-label');
  if (al) return al.slice(0, 28);

  // 3. CSS module class
  const mod = moduleLocalName(el);
  if (mod) return mod;

  // 4. role
  const role = el.getAttribute('role');
  if (role) return role;

  // 5. id
  const id = el.id;
  if (id && !id.startsWith('storybook')) return id;

  // 6. tag
  return el.tagName.toLowerCase();
}

function getLayerIcon(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || el.getAttribute('role') === 'button') return '◉';
  if (tag === 'input' || tag === 'textarea') return '⊟';
  if (tag === 'img') return '⬜';
  if (tag === 'svg') return '◆';
  if (tag === 'a') return '⬡';
  if (el.children.length === 0) return 'T';
  return '⬡';
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export interface TreeNode {
  id:       string;
  name:     string;
  icon:     string;
  tag:      string;
  path:     number[];
  children: TreeNode[];
  leafText?: string;
  w: number;
  h: number;
}

const SKIP_TAGS = new Set(['PATH', 'DEFS', 'G', 'MASK', 'CLIPPATH', 'LINEARGRADIENT']);
const MAX_DEPTH = 7;

function buildTree(el: Element, path: number[] = [], depth = 0): TreeNode {
  const children: TreeNode[] = [];

  if (depth < MAX_DEPTH) {
    let i = 0;
    for (const child of Array.from(el.children)) {
      if (SKIP_TAGS.has(child.tagName)) { i++; continue; }
      if (child.getAttribute('aria-hidden') === 'true') { i++; continue; }
      const rect = child.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { i++; continue; }
      children.push(buildTree(child, [...path, i], depth + 1));
      i++;
    }
  }

  const rect = el.getBoundingClientRect();
  const name = getLayerName(el);
  const icon = getLayerIcon(el);
  const isLeaf = el.children.length === 0;
  const text = el.textContent?.trim();

  return {
    id:       path.length === 0 ? 'root' : path.join('-'),
    name,
    icon,
    tag:      el.tagName.toLowerCase(),
    path,
    children,
    leafText: isLeaf && text ? text.slice(0, 30) : undefined,
    w:        Math.round(rect.width),
    h:        Math.round(rect.height),
  };
}

// ─── Channel handlers ─────────────────────────────────────────────────────────

function getStoryRoot(): Element | null {
  return document.querySelector('#storybook-root > *, #root > *');
}

function getElementByPath(path: number[]): Element | null {
  let el = getStoryRoot();
  for (const idx of path) {
    el = el?.children[idx] ?? null;
  }
  return el;
}

// Extract Tailwind semantic token name from a class like "bg-destructive/10" → "--destructive"
// or "text-primary-foreground" → "--primary-foreground", etc.
function tailwindClassToToken(cls: string): { prop: 'bg' | 'text' | 'border'; token: string } | null {
  const m = cls.match(/^(bg|text|border)-([\w-]+?)(?:\/[\d.]+)?$/);
  if (!m) return null;
  const [, type, name] = m;
  // Skip pure utility names that aren't CSS vars (e.g. bg-white, text-xs)
  if (['white', 'black', 'transparent', 'current', 'inherit'].includes(name)) return null;
  if (/^\d/.test(name)) return null; // numeric sizes like text-xs
  return { prop: type as 'bg' | 'text' | 'border', token: `--${name}` };
}

function readStyles(el: Element): Record<string, string> | null {
  if (!(el instanceof HTMLElement)) return null;
  const c    = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const isLeaf = el.childElementCount === 0;

  // Walk up from el to find the first element with a Tailwind bg/text/border class
  // (the element itself first, then its class string)
  let bgToken = '', textToken = '', borderToken = '';
  const classes = Array.from(el.classList);
  for (const cls of classes) {
    const t = tailwindClassToToken(cls);
    if (!t) continue;
    if (t.prop === 'bg'     && !bgToken)     bgToken     = t.token;
    if (t.prop === 'text'   && !textToken)   textToken   = t.token;
    if (t.prop === 'border' && !borderToken) borderToken = t.token;
  }

  return {
    backgroundColor: rgbToHex(c.backgroundColor),
    color:           rgbToHex(c.color),
    borderColor:     rgbToHex(c.borderColor),
    bgToken,
    textToken,
    borderToken,
    borderWidth:     c.borderWidth,
    borderStyle:     c.borderStyle,
    borderRadius:    c.borderRadius,
    gap:             c.gap,
    paddingTop:      c.paddingTop,
    paddingRight:    c.paddingRight,
    paddingBottom:   c.paddingBottom,
    paddingLeft:     c.paddingLeft,
    opacity:         c.opacity,
    fontSize:        c.fontSize,
    fontWeight:      c.fontWeight,
    width:           Math.round(rect.width)  + 'px',
    height:          Math.round(rect.height) + 'px',
    boxShadow:       c.boxShadow,
    leafText:        isLeaf ? (el.textContent?.trim() ?? '') : '',
  };
}

// ─── Highlight ────────────────────────────────────────────────────────────────

let _hlEl: HTMLElement | null = null;
let _hlOutline = '';
let _hlOffset  = '';

function setHighlight(el: HTMLElement | null) {
  if (_hlEl) {
    _hlEl.style.outline      = _hlOutline;
    _hlEl.style.outlineOffset = _hlOffset;
    _hlEl = null;
  }
  if (el) {
    _hlOutline = el.style.outline;
    _hlOffset  = el.style.outlineOffset;
    el.style.outline       = '2px solid #f472b6';
    el.style.outlineOffset = '-1px';
    _hlEl = el;
  }
}

// Build & emit the layer tree
channel.on('DESIGN/BUILD_TREE', () => {
  setHighlight(null);
  const root = getStoryRoot();
  if (!root) return channel.emit('DESIGN/TREE', null);
  channel.emit('DESIGN/TREE', buildTree(root));
});

// Inspect the root element
channel.on('DESIGN/INSPECT', () => {
  setHighlight(null);
  const root = getStoryRoot();
  channel.emit('DESIGN/STYLES', root ? readStyles(root) : null);
});

// Inspect a specific layer by path + highlight it
channel.on('DESIGN/SELECT_LAYER', (path: number[]) => {
  const el = getElementByPath(path);
  if (el instanceof HTMLElement) setHighlight(el);
  channel.emit('DESIGN/STYLES', el ? readStyles(el) : null);
});

// Update text content of a leaf element
channel.on('DESIGN/SET_TEXT', ({ path, text }: { path: number[]; text: string }) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (el && el.childElementCount === 0) el.textContent = text;
});

// ── CSS override engine ────────────────────────────────────────────────────────
// Uses an injected <style> element so the :root rules appear LAST in the
// document (highest cascade position) and reliably override global.css values.
// This is more predictable than documentElement.style.setProperty because it
// avoids any specificity ambiguity with existing inline styles.

const _overrideMap: Record<string, string> = {};
const OVERRIDE_STYLE_ID = '__keye-design-overrides__';

function _flushOverrides() {
  let el = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = OVERRIDE_STYLE_ID;
    document.head.appendChild(el);
  }
  const entries = Object.entries(_overrideMap).filter(([p]) => p.startsWith('--'));
  el.textContent = entries.length === 0
    ? ''
    : `:root {\n${entries.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
}

channel.on('DESIGN/APPLY', (overrides: Record<string, string>) => {
  Object.assign(_overrideMap, overrides);
  _flushOverrides();
});

channel.on('DESIGN/RESET_PROP', (prop: string) => {
  delete _overrideMap[prop];
  _flushOverrides();
});

channel.on('DESIGN/RESET_ALL', () => {
  Object.keys(_overrideMap).forEach(k => delete _overrideMap[k]);
  _flushOverrides();
});

// Resolve a list of CSS custom property names using the browser's own
// colour pipeline.  getComputedStyle(root).getPropertyValue('--foo') returns
// the raw declaration (e.g. "oklch(0.577 0.245 27.325)") — it does NOT resolve
// colour functions.  To get the actual rendered hex we create a hidden element,
// apply `background-color: var(--foo)` to it, and read back getComputedStyle
// .backgroundColor which the browser fully resolves to rgb().
channel.on('DESIGN/RESOLVE_TOKENS', (names: string[]) => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(probe);

  const resolved: Record<string, string> = {};
  for (const name of names) {
    probe.style.backgroundColor = `var(${name})`;
    const computed = getComputedStyle(probe).backgroundColor;
    if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
      resolved[name] = rgbToHex(computed);
    }
  }

  document.body.removeChild(probe);
  channel.emit('DESIGN/RESOLVED_TOKENS', resolved);
});

export const decorators: Decorator[] = [];
