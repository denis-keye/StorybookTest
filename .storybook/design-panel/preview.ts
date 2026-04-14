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

function getStoryContainer(): Element | null {
  return document.querySelector('#storybook-root, #root');
}

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
    borderTopLeftRadius:     c.borderTopLeftRadius,
    borderTopRightRadius:    c.borderTopRightRadius,
    borderBottomRightRadius: c.borderBottomRightRadius,
    borderBottomLeftRadius:  c.borderBottomLeftRadius,
    gap:             c.gap,
    paddingTop:      c.paddingTop,
    paddingRight:    c.paddingRight,
    paddingBottom:   c.paddingBottom,
    paddingLeft:     c.paddingLeft,
    marginTop:       c.marginTop,
    marginRight:     c.marginRight,
    marginBottom:    c.marginBottom,
    marginLeft:      c.marginLeft,
    opacity:         c.opacity,
    fontSize:        c.fontSize,
    fontWeight:      c.fontWeight,
    fontFamily:      c.fontFamily,
    lineHeight:      c.lineHeight,
    letterSpacing:   c.letterSpacing,
    textAlign:       c.textAlign,
    textDecoration:  c.textDecorationLine,
    textTransform:   c.textTransform,
    width:           Math.round(rect.width)  + 'px',
    height:          Math.round(rect.height) + 'px',
    minWidth:        c.minWidth,
    maxWidth:        c.maxWidth,
    minHeight:       c.minHeight,
    maxHeight:       c.maxHeight,
    display:         c.display,
    flexDirection:   c.flexDirection,
    justifyContent:  c.justifyContent,
    alignItems:      c.alignItems,
    flexWrap:        c.flexWrap,
    position:        c.position,
    top:             c.top,
    right:           c.right,
    bottom:          c.bottom,
    left:            c.left,
    zIndex:          c.zIndex,
    overflow:        c.overflow,
    overflowX:       c.overflowX,
    overflowY:       c.overflowY,
    boxShadow:       c.boxShadow,
    filter:          c.filter,
    backdropFilter:  c.backdropFilter,
    transition:      c.transition,
    transform:       c.transform,
    cursor:          c.cursor,
    classList:       el.className,
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
// path=[] means the story root element itself
channel.on('DESIGN/SELECT_LAYER', (path: number[]) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (el instanceof HTMLElement) setHighlight(el);
  channel.emit('DESIGN/STYLES', el ? readStyles(el as HTMLElement) : null);
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

channel.on('DESIGN/RESET_ALL', () => _doResetAll());

// Resolve a list of CSS custom property names using the browser's own
// colour pipeline.  getComputedStyle(root).getPropertyValue('--foo') returns
// the raw declaration (e.g. "oklch(0.577 0.245 27.325)") — it does NOT resolve
// colour functions.  To get the actual rendered hex we create a hidden element,
// apply `background-color: var(--foo)` to it, and read back getComputedStyle
// .backgroundColor which the browser fully resolves to rgb().
channel.on('DESIGN/RESOLVE_TOKENS', (names: string[]) => {
  // Use a canvas to resolve colors — canvas always converts to sRGB rgb()
  // so oklch / display-p3 / etc. all give correct values even in Safari.
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const ctx = canvas.getContext('2d');

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(probe);

  const resolved: Record<string, string> = {};
  for (const name of names) {
    probe.style.backgroundColor = `var(${name})`;
    const computed = getComputedStyle(probe).backgroundColor;
    if (!computed || computed === 'rgba(0, 0, 0, 0)' || computed === 'transparent') continue;

    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      resolved[name] = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    } else {
      resolved[name] = rgbToHex(computed);
    }
  }

  document.body.removeChild(probe);
  channel.emit('DESIGN/RESOLVED_TOKENS', resolved);
});

// Update a Storybook story arg (e.g. variant prop) so CVA re-renders the component
channel.on('DESIGN/SET_STORY_ARG', ({ prop, value }: { prop: string; value: string }) => {
  // Storybook's preview API exposes updateStoryArgs via the STORY_ARGS_UPDATED channel.
  // The simplest cross-iframe approach: emit UPDATE_STORY_ARGS on the same channel.
  channel.emit('updateGlobals', {});  // noop to ensure channel is alive
  // Use the manager-facing UPDATE_STORY_ARGS event
  channel.emit('updateArgs', { updatedArgs: { [prop]: value } });
});

// ── Per-element original-state snapshots for reset/undo ────────────────────
// Key: serialised path array e.g. "0,1,2"
const _origStyle   = new Map<string, string>();   // element.style.cssText before first mutation
const _origClasses = new Map<string, string>();   // element.className before first mutation
// Undo stack: array of { path, kind, prop?, value?, cls? } in apply order
const _undoStack: Array<{ pathKey: string; kind: 'style' | 'class'; prop?: string; prev?: string; cls?: string; added?: boolean }> = [];

function pathKey(path: number[]) { return path.join(','); }

function snapshotEl(el: HTMLElement, key: string) {
  if (!_origStyle.has(key))   _origStyle.set(key, el.style.cssText);
  if (!_origClasses.has(key)) _origClasses.set(key, el.className);
}

// Apply pseudo-state on an element: dispatches real browser events + data attrs
function applyPseudoState(el: HTMLElement, pseudo: string, on: boolean) {
  if (pseudo === 'hover') {
    el.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true }));
    if (on) el.setAttribute('data-hover', 'true');
    else    el.removeAttribute('data-hover');
  } else if (pseudo === 'focus') {
    if (on) el.focus();
    else    el.blur();
    if (on) el.setAttribute('data-focus', 'true');
    else    el.removeAttribute('data-focus');
  } else if (pseudo === 'active') {
    el.dispatchEvent(new MouseEvent(on ? 'mousedown' : 'mouseup', { bubbles: true }));
    if (on) el.setAttribute('data-active', 'true');
    else    el.removeAttribute('data-active');
  } else if (pseudo === 'disabled') {
    if (on) {
      (el as HTMLButtonElement | HTMLInputElement).disabled = true;
      el.setAttribute('data-disabled', 'true');
    } else {
      (el as HTMLButtonElement | HTMLInputElement).disabled = false;
      el.removeAttribute('data-disabled');
    }
  }
}

// Add a class to a specific element by path
channel.on('DESIGN/ADD_CLASS', ({ path, cls }: { path: number[]; cls: string }) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (el instanceof HTMLElement) {
    const key = pathKey(path);
    snapshotEl(el, key);
    cls.trim().split(/\s+/).forEach(c => {
      if (!c) return;
      // pseudo-* classes trigger real browser pseudo-state simulation
      const pseudoMatch = c.match(/^pseudo-(\w+)$/);
      if (pseudoMatch) {
        applyPseudoState(el, pseudoMatch[1], true);
        return; // don't add to classList
      }
      if (!el.classList.contains(c)) {
        el.classList.add(c);
        _undoStack.push({ pathKey: key, kind: 'class', cls: c, added: true });
      }
    });
    channel.emit('DESIGN/STYLES', readStyles(el));
  }
});

// Remove a class from a specific element by path
channel.on('DESIGN/REMOVE_CLASS', ({ path, cls }: { path: number[]; cls: string }) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (el instanceof HTMLElement) {
    const key = pathKey(path);
    snapshotEl(el, key);
    cls.trim().split(/\s+/).forEach(c => {
      if (!c) return;
      const pseudoMatch = c.match(/^pseudo-(\w+)$/);
      if (pseudoMatch) {
        applyPseudoState(el, pseudoMatch[1], false);
        return;
      }
      if (el.classList.contains(c)) {
        el.classList.remove(c);
        _undoStack.push({ pathKey: key, kind: 'class', cls: c, added: false });
      }
    });
    channel.emit('DESIGN/STYLES', readStyles(el));
  }
});

// Set an inline style property directly on an element by path
channel.on('DESIGN/SET_INLINE_STYLE', ({ path, prop, value }: { path: number[]; prop: string; value: string }) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (el instanceof HTMLElement) {
    const key = pathKey(path);
    snapshotEl(el, key);
    const prev = el.style.getPropertyValue(prop);
    if (value) {
      el.style.setProperty(prop, value);
    } else {
      el.style.removeProperty(prop);
    }
    _undoStack.push({ pathKey: key, kind: 'style', prop, prev });
    channel.emit('DESIGN/STYLES', readStyles(el));
  }
});

// Undo the last inline mutation
channel.on('DESIGN/UNDO_INLINE', () => {
  const op = _undoStack.pop();
  if (!op) return;
  // Reconstruct path from key
  const path = op.pathKey === '' ? [] : op.pathKey.split(',').map(Number);
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (!(el instanceof HTMLElement)) return;
  if (op.kind === 'style' && op.prop !== undefined) {
    if (op.prev) el.style.setProperty(op.prop, op.prev);
    else el.style.removeProperty(op.prop);
  } else if (op.kind === 'class' && op.cls) {
    if (op.added) el.classList.remove(op.cls);
    else el.classList.add(op.cls);
  }
  channel.emit('DESIGN/STYLES', readStyles(el));
});

// Full reset: CSS variable overrides + all inline style / className mutations
function _doResetAll() {
  Object.keys(_overrideMap).forEach(k => delete _overrideMap[k]);
  _flushOverrides();
  // Restore per-element mutations
  _origStyle.forEach((cssText, key) => {
    const path = key === '' ? [] : key.split(',').map(Number);
    const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
    if (el instanceof HTMLElement) el.style.cssText = cssText;
  });
  _origClasses.forEach((className, key) => {
    const path = key === '' ? [] : key.split(',').map(Number);
    const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
    if (el instanceof HTMLElement) el.className = className;
  });
  _origStyle.clear();
  _origClasses.clear();
  _undoStack.length = 0;
  // Re-emit styles for whatever is currently inspected
  const root = getStoryRoot();
  if (root) channel.emit('DESIGN/STYLES', readStyles(root));
}

// Set canvas (story iframe body) background color
channel.on('DESIGN/SET_CANVAS_BG', ({ color }: { color: string }) => {
  document.body.style.background = color;
  document.documentElement.style.background = color;
});

// Toggle light/dark theme on the preview document so components re-render
// with the correct CSS variable set (requires .dark class convention).
channel.on('DESIGN/SET_THEME', ({ theme }: { theme: 'light' | 'dark' }) => {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
});

// Tell the panel that the preview iframe is ready so it can re-apply current theme/bg.
// This fires after all channel.on() listeners are registered.
setTimeout(() => {
  channel.emit('DESIGN/PREVIEW_READY');
}, 0);

// Wrap the target element in a new empty div, rebuild tree
channel.on('DESIGN/WRAP_IN_DIV', ({ path }: { path: number[] }) => {
  const el = path.length === 0 ? getStoryRoot() : getElementByPath(path);
  if (!(el instanceof HTMLElement) || !el.parentElement) return;
  const wrapper = document.createElement('div');
  wrapper.style.display = 'block'; // block by default so padding/fill are visible
  el.parentElement.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  channel.emit('DESIGN/BUILD_TREE');
  channel.emit('DESIGN/TREE', buildTree(getStoryRoot()!));
});

// Insert an empty inline sibling span after the target element, rebuild tree
channel.on('DESIGN/INSERT_SIBLING', ({ path }: { path: number[] }) => {
  let parent: HTMLElement | null = null;
  let insertAfter: Element | null = null;

  if (path.length === 0) {
    // Root element selected — append inside it (as last child) so it stays in the tree
    const root = getStoryRoot();
    if (!(root instanceof HTMLElement)) return;
    parent = root;
    insertAfter = root.lastElementChild;
  } else {
    const el = getElementByPath(path);
    if (!(el instanceof HTMLElement) || !el.parentElement) return;
    parent = el.parentElement;
    insertAfter = el;
  }

  const sibling = document.createElement('span');
  sibling.textContent = 'New element';
  sibling.style.cssText = 'display:inline-block;min-width:4px;min-height:4px;';
  parent.insertBefore(sibling, insertAfter ? insertAfter.nextSibling : null);
  // Defer so the browser lays out the new element before buildTree measures bounding rects
  requestAnimationFrame(() => {
    channel.emit('DESIGN/BUILD_TREE');
    channel.emit('DESIGN/TREE', buildTree(getStoryRoot()!));
  });
});

export const decorators: Decorator[] = [];
