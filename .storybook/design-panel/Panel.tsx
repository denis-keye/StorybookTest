import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { addons, useStorybookApi } from '@storybook/manager-api';
import type { TreeNode } from './preview';

// When building the static Storybook for Vercel, set STORYBOOK_API_BASE to the
// Next.js deployment URL (e.g. https://my-app.vercel.app) so API calls route to
// the serverless functions instead of the local Vite plugin.
// Storybook uses Vite, so env vars are accessed via import.meta.env (prefixed STORYBOOK_).
const _importMetaEnv = (typeof import.meta !== 'undefined')
  ? (import.meta as unknown as Record<string, Record<string, string>>).env
  : undefined;
const API_BASE: string = (_importMetaEnv?.STORYBOOK_API_BASE ?? '').replace(/\/$/, '');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenEntry {
  name:     string;
  raw:      string;
  resolved: string;
  group:    string;
  type:     'color' | 'size' | 'shadow' | 'font' | 'other';
}

interface ElementStyles {
  backgroundColor: string;
  color:           string;
  borderColor:     string;
  bgToken:         string;
  textToken:       string;
  borderToken:     string;
  borderWidth:     string;
  borderStyle:     string;
  borderRadius:    string;
  borderTopLeftRadius:     string;
  borderTopRightRadius:    string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius:  string;
  gap:             string;
  paddingTop:      string;
  paddingRight:    string;
  paddingBottom:   string;
  paddingLeft:     string;
  marginTop:       string;
  marginRight:     string;
  marginBottom:    string;
  marginLeft:      string;
  opacity:         string;
  fontSize:        string;
  fontWeight:      string;
  fontFamily:      string;
  lineHeight:      string;
  letterSpacing:   string;
  textAlign:       string;
  textDecoration:  string;
  textTransform:   string;
  width:           string;
  height:          string;
  minWidth:        string;
  maxWidth:        string;
  minHeight:       string;
  maxHeight:       string;
  display:         string;
  flexDirection:   string;
  justifyContent:  string;
  alignItems:      string;
  flexWrap:        string;
  position:        string;
  top:             string;
  right:           string;
  bottom:          string;
  left:            string;
  zIndex:          string;
  overflow:        string;
  overflowX:       string;
  overflowY:       string;
  boxShadow:       string;
  filter:          string;
  backdropFilter:  string;
  transition:      string;
  transform:       string;
  cursor:          string;
  classList:       string;
  leafText:        string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findToken(tokens: TokenEntry[], hex: string, classHint?: string) {
  // If the preview gave us a direct class-derived token name (e.g. "--destructive"
  // from "bg-destructive/10"), prefer that — it survives opacity modifiers.
  if (classHint) {
    const byName = tokens.find(t => t.name === classHint);
    if (byName) return byName;
  }
  const norm = hex.toLowerCase().trim();
  if (!norm || norm === 'rgba(0, 0, 0, 0)' || norm === 'transparent') return undefined;
  const matches = tokens.filter(t => t.resolved.toLowerCase() === norm);
  // Prefer semantic tokens (those that alias another var) over raw primitives
  return matches.find(t => t.raw.startsWith('var(')) ?? matches[0];
}

function isColorToken(t: TokenEntry)  { return t.type === 'color'; }
function isSizeToken(t: TokenEntry)   { return t.type === 'size'; }

function shortName(name: string) { return name.replace(/^--/, ''); }

function tokenSwatch(resolved: string): React.CSSProperties {
  const isColor = /^#|^rgb/.test(resolved.trim());
  return {
    width: 14, height: 14, borderRadius: 2, flexShrink: 0,
    background: isColor ? resolved : 'transparent',
    border: isColor ? '1px solid rgba(255,255,255,0.15)' : 'none',
  };
}

// ─── Token Picker ─────────────────────────────────────────────────────────────

interface TokenPickerProps {
  tokens:    TokenEntry[];
  filter:    'color' | 'size' | 'all';
  current:   string;
  onSelect:  (entry: TokenEntry | null, raw?: string) => void;
  onClose:   () => void;
  anchorRef: React.RefObject<HTMLElement>;
}

function TokenPicker({ tokens, filter, current, onSelect, onClose, anchorRef }: TokenPickerProps) {
  const [search,  setSearch]  = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [rawVal,  setRawVal]  = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = tokens.filter(t => {
    if (filter === 'color' && !isColorToken(t)) return false;
    if (filter === 'size'  && !isSizeToken(t))  return false;
    if (search && !t.name.includes(search) && !t.resolved.toLowerCase().includes(search)) return false;
    return true;
  });

  const groups: Record<string, TokenEntry[]> = {};
  for (const t of filtered) {
    if (!groups[t.group]) groups[t.group] = [];
    groups[t.group].push(t);
  }

  useEffect(() => {
    const el = anchorRef.current;
    const box = ref.current;
    if (!el || !box) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 280) {
      box.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      box.style.top    = 'auto';
    } else {
      box.style.top    = (rect.bottom + 4) + 'px';
      box.style.bottom = 'auto';
    }
    box.style.left = Math.min(rect.left, window.innerWidth - 268) + 'px';
  });

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node))
        onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose, anchorRef]);

  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 9999, width: 264, maxHeight: 340,
      background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: 12,
    }}>
      <div style={{ padding: '7px 8px 5px', borderBottom: '1px solid #21262d' }}>
        <input autoFocus placeholder="Search tokens…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 12, padding: '4px 8px', outline: 'none', fontFamily: 'inherit' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div style={{ padding: '6px 10px 2px', fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{group}</div>
            {items.map(t => {
              const active = t.name === current || `var(${t.name})` === current;
              return (
                <div key={t.name} onClick={() => onSelect(t)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 10px', cursor: 'pointer', background: active ? '#21262d' : 'transparent' }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#1c2128'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {isColorToken(t) && <div style={{ ...tokenSwatch(t.resolved) }} />}
                  <span style={{ flex: 1, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(t.name)}</span>
                  <span style={{ color: '#6e7681', fontFamily: 'monospace', fontSize: 10, flexShrink: 0 }}>{t.resolved}</span>
                </div>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: 12, color: '#6e7681', textAlign: 'center' }}>No tokens match</div>}
      </div>

      <div style={{ borderTop: '1px solid #21262d', padding: '5px 8px' }}>
        {rawMode ? (
          <div style={{ display: 'flex', gap: 5 }}>
            <input autoFocus placeholder="Raw value…" value={rawVal} onChange={e => setRawVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onSelect(null, rawVal); setRawMode(false); } }}
              style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'monospace' }} />
            <button onClick={() => { onSelect(null, rawVal); setRawMode(false); }}
              style={{ background: '#238636', border: 'none', color: '#fff', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>Apply</button>
          </div>
        ) : (
          <button onClick={() => setRawMode(true)}
            style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11, width: '100%' }}>
            Enter raw value
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Token Field ──────────────────────────────────────────────────────────────

interface TokenFieldProps {
  value:    string;
  tokens:   TokenEntry[];
  filter:   'color' | 'size' | 'all';
  onChange: (v: string) => void;
  flex?:    number;
}

function TokenField({ value, tokens, filter, onChange, flex = 1 }: TokenFieldProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  const tokenName = value.startsWith('var(') ? value.slice(4, -1) : undefined;
  const entry     = tokenName ? tokens.find(t => t.name === tokenName)
                              : tokens.find(t => t.resolved.toLowerCase() === value.toLowerCase());
  const resolved  = entry?.resolved ?? value;
  const display   = tokenName ? shortName(tokenName) : (value || '—');

  return (
    <>
      <div ref={anchor} onClick={() => setOpen(o => !o)} title={value}
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', background: '#0d1117', border: '1px solid #30363d', flex, minWidth: 0, userSelect: 'none' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#58a6ff'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#30363d'}
      >
        {filter === 'color' && <div style={{ ...tokenSwatch(resolved || 'transparent') }} />}
        <span style={{ flex: 1, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{display}</span>
        <span style={{ color: '#6e7681', fontSize: 9, flexShrink: 0 }}>▾</span>
      </div>
      {open && (
        <TokenPicker tokens={tokens} filter={filter} current={value}
          onSelect={(entry, raw) => { onChange(entry ? `var(${entry.name})` : (raw ?? '')); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={anchor as React.RefObject<HTMLElement>} />
      )}
    </>
  );
}

// ─── Layer Tree ───────────────────────────────────────────────────────────────

interface LayerRowProps {
  node:        TreeNode;
  depth:       number;
  selectedId:  string | null;
  layerNames:  Record<string, string>;
  onSelect:    (node: TreeNode) => void;
  onRename:    (id: string, name: string) => void;
}

function LayerRow({ node, depth, selectedId, layerNames, onSelect, onRename }: LayerRowProps) {
  const [open,    setOpen]    = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const hasChildren = node.children.length > 0;
  const isSelected  = node.id === selectedId;
  const displayName = layerNames[node.id] ?? node.name;

  useLayoutEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditVal(displayName);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editVal.trim();
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed);
    else if (!trimmed) onRename(node.id, ''); // clear override → revert to DOM name
    setEditing(false);
  };

  return (
    <>
      <div
        onClick={() => !editing && onSelect(node)}
        onDoubleClick={startEdit}
        style={{
          display: 'flex', alignItems: 'center',
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 26,
          cursor: 'pointer',
          background: isSelected ? '#1f3a5f' : 'transparent',
          borderLeft: isSelected ? '2px solid #58a6ff' : '2px solid transparent',
          userSelect: 'none',
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#161b22'; }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Expand / collapse triangle */}
        <span
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          style={{
            width: 14, flexShrink: 0, color: '#6e7681', fontSize: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s',
          }}
        >▶</span>

        {/* Layer icon */}
        <span style={{ marginRight: 5, fontSize: 10, color: isSelected ? '#58a6ff' : '#6e7681', flexShrink: 0 }}>
          {node.icon}
        </span>

        {/* Layer name — inline edit on double-click */}
        {editing ? (
          <input
            ref={inputRef}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, background: '#0d1117', border: '1px solid #58a6ff', borderRadius: 3, color: '#e6edf3', fontSize: 11, padding: '1px 4px', outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: isSelected ? '#e6edf3' : '#c9d1d9' }}
            title="Double-click to rename">
            {displayName}
            {layerNames[node.id] && <span style={{ color: '#6e7681', fontSize: 9, marginLeft: 3 }}>✎</span>}
          </span>
        )}

        {/* Size hint */}
        {isSelected && !editing && node.w > 0 && (
          <span style={{ fontSize: 9, color: '#6e7681', flexShrink: 0, marginLeft: 4 }}>
            {node.w}×{node.h}
          </span>
        )}
      </div>

      {/* Children */}
      {open && hasChildren && node.children.map(child => (
        <LayerRow key={child.id} node={child} depth={depth + 1}
          selectedId={selectedId} layerNames={layerNames}
          onSelect={onSelect} onRename={onRename} />
      ))}
    </>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ label, children, defaultOpen = true, noPad = false }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean; noPad?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #21262d' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', cursor: 'pointer', color: '#8b949e' }}>
        <span style={{ fontSize: 8, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s', display: 'inline-block' }}>▶</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
      </button>
      {open && <div style={noPad ? {} : { padding: '0 12px 10px' }}>{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      {label && <span style={{ width: 52, flexShrink: 0, fontSize: 10, color: '#6e7681' }}>{label}</span>}
      {children}
    </div>
  );
}

// ─── NumberInput ──────────────────────────────────────────────────────────────

function parsePx(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n);
}

function NumberInput({ value, onChange, min, max, step = 1, suffix = '', placeholder = '—', style: extraStyle }: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number;
  suffix?: string; placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [local, setLocal] = useState('');
  const [active, setActive] = useState(false);
  const display = active ? local : (parsePx(value) === 0 && !value ? '' : parsePx(value).toString());

  return (
    <div style={{ display: 'flex', alignItems: 'center', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, overflow: 'hidden', flex: 1, ...extraStyle }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#58a6ff'}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = '#30363d'; }}>
      <input
        value={active ? local : display}
        placeholder={placeholder}
        onFocus={e => { setLocal(display); setActive(true); (e.target.parentElement as HTMLElement).style.borderColor = '#58a6ff'; }}
        onBlur={e => {
          setActive(false);
          (e.target.parentElement as HTMLElement).style.borderColor = '#30363d';
          const n = parseFloat(local);
          if (!isNaN(n)) onChange(n + (suffix || 'px'));
        }}
        onChange={e => setLocal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); const n = parsePx(value) + step; if (max === undefined || n <= max) onChange(n + (suffix || 'px')); }
          if (e.key === 'ArrowDown') { e.preventDefault(); const n = parsePx(value) - step; if (min === undefined || n >= min) onChange(n + (suffix || 'px')); }
        }}
        style={{ flex: 1, background: 'transparent', border: 'none', color: '#c9d1d9', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'monospace', minWidth: 0, width: '100%' }}
      />
      {suffix && <span style={{ color: '#6e7681', fontSize: 10, paddingRight: 5, flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

// ─── SelectInput ──────────────────────────────────────────────────────────────

function SelectInput({ value, options, onChange, style: extraStyle }: {
  value: string; options: { label: string; value: string }[];
  onChange: (v: string) => void; style?: React.CSSProperties;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '3px 6px', outline: 'none', cursor: 'pointer', flex: 1, fontFamily: 'inherit', ...extraStyle }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── SegmentedControl ─────────────────────────────────────────────────────────

function SegmentedControl({ options, value, onChange, title }: {
  options: { label: string; value: string; title?: string }[];
  value: string; onChange: (v: string) => void; title?: string;
}) {
  return (
    <div title={title} style={{ display: 'flex', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
      {options.map(o => (
        <button key={o.value} title={o.title ?? o.label} onClick={() => onChange(o.value)}
          style={{
            padding: '3px 7px', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            background: value === o.value ? '#1f6feb' : 'transparent',
            color: value === o.value ? '#fff' : '#8b949e',
            borderRight: '1px solid #30363d',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

function IconBtn({ children, active, onClick, title }: {
  children: React.ReactNode; active?: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button title={title} onClick={onClick}
      style={{
        padding: '3px 6px', border: '1px solid ' + (active ? '#1f6feb' : '#30363d'),
        borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
        background: active ? '#1f3a5f' : 'transparent',
        color: active ? '#58a6ff' : '#8b949e',
        flexShrink: 0,
      }}>
      {children}
    </button>
  );
}

// ─── SpacingBox ───────────────────────────────────────────────────────────────

function SpacingBox({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;

  const pad = {
    top:    parsePx(styles.paddingTop),
    right:  parsePx(styles.paddingRight),
    bottom: parsePx(styles.paddingBottom),
    left:   parsePx(styles.paddingLeft),
  };

  const sideInput = (prop: string, val: number, style?: React.CSSProperties) => (
    <input
      defaultValue={val}
      key={val}
      onBlur={e => onChangeInline(prop, (e.target as HTMLInputElement).value + 'px')}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 28, textAlign: 'center', background: '#0d1117', border: '1px solid #30363d',
        borderRadius: 3, color: '#c9d1d9', fontSize: 10, padding: '2px 0', outline: 'none',
        fontFamily: 'monospace', ...style,
      }}
      onFocus={e => (e.target as HTMLInputElement).select()}
    />
  );

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Padding</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {/* Top */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {sideInput('padding-top', pad.top)}
        </div>
        {/* Middle row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {sideInput('padding-left', pad.left)}
          <div style={{
            width: 70, height: 32, border: '1px dashed #30363d', borderRadius: 3,
            background: '#161b22', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 9, color: '#6e7681' }}>element</span>
          </div>
          {sideInput('padding-right', pad.right)}
        </div>
        {/* Bottom */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {sideInput('padding-bottom', pad.bottom)}
        </div>
      </div>
    </div>
  );
}

// ─── LayoutControls ───────────────────────────────────────────────────────────

const FLEX_DIRECTION_OPTS = [
  { label: '→', value: 'row',         title: 'Row' },
  { label: '↓', value: 'column',      title: 'Column' },
  { label: '←', value: 'row-reverse', title: 'Row Reverse' },
  { label: '↑', value: 'column-reverse', title: 'Column Reverse' },
];
const JUSTIFY_OPTS = [
  { label: '⇤',  value: 'flex-start',    title: 'Flex Start' },
  { label: '⇥',  value: 'flex-end',      title: 'Flex End' },
  { label: '⇔',  value: 'center',        title: 'Center' },
  { label: '↔',  value: 'space-between', title: 'Space Between' },
  { label: '⟺', value: 'space-around',  title: 'Space Around' },
  { label: '≡',  value: 'space-evenly',  title: 'Space Evenly' },
];
const ALIGN_OPTS = [
  { label: '⊤', value: 'flex-start', title: 'Start' },
  { label: '⊞', value: 'center',     title: 'Center' },
  { label: '⊥', value: 'flex-end',   title: 'End' },
  { label: '↕', value: 'stretch',    title: 'Stretch' },
  { label: '—', value: 'baseline',   title: 'Baseline' },
];
const WRAP_OPTS = [
  { label: 'No wrap',  value: 'nowrap' },
  { label: 'Wrap',     value: 'wrap' },
  { label: 'Wrap rev', value: 'wrap-reverse' },
];

function LayoutControls({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;

  const isFlex = styles.display === 'flex' || styles.display === 'inline-flex';
  const isGrid = styles.display === 'grid' || styles.display === 'inline-grid';

  const displayOpts = [
    { label: 'block',  value: 'block' },
    { label: 'flex',   value: 'flex' },
    { label: 'grid',   value: 'grid' },
    { label: 'inline', value: 'inline' },
    { label: 'none',   value: 'none' },
  ];

  return (
    <div>
      <Row label="Display">
        <SelectInput value={styles.display} options={displayOpts} onChange={v => onChangeInline('display', v)} />
      </Row>

      {isFlex && (
        <>
          <Row label="Direction">
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {FLEX_DIRECTION_OPTS.map(o => (
                <IconBtn key={o.value} active={styles.flexDirection === o.value} onClick={() => onChangeInline('flex-direction', o.value)} title={o.title}>
                  {o.label}
                </IconBtn>
              ))}
            </div>
          </Row>
          <Row label="Justify">
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {JUSTIFY_OPTS.map(o => (
                <IconBtn key={o.value} active={styles.justifyContent === o.value} onClick={() => onChangeInline('justify-content', o.value)} title={o.title}>
                  {o.label}
                </IconBtn>
              ))}
            </div>
          </Row>
          <Row label="Align">
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {ALIGN_OPTS.map(o => (
                <IconBtn key={o.value} active={styles.alignItems === o.value} onClick={() => onChangeInline('align-items', o.value)} title={o.title}>
                  {o.label}
                </IconBtn>
              ))}
            </div>
          </Row>
          <Row label="Wrap">
            <SelectInput value={styles.flexWrap} options={WRAP_OPTS} onChange={v => onChangeInline('flex-wrap', v)} />
          </Row>
          <Row label="Gap">
            <NumberInput value={styles.gap} onChange={v => onChangeInline('gap', v)} min={0} />
          </Row>
        </>
      )}

      {isGrid && (
        <Row label="Gap">
          <NumberInput value={styles.gap} onChange={v => onChangeInline('gap', v)} min={0} />
        </Row>
      )}
    </div>
  );
}

// ─── SizeControls ─────────────────────────────────────────────────────────────

function SizeControls({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  return (
    <div>
      <Row label="W × H">
        <NumberInput value={styles.width}  onChange={v => onChangeInline('width', v)}  placeholder="auto" />
        <span style={{ color: '#6e7681', fontSize: 10 }}>×</span>
        <NumberInput value={styles.height} onChange={v => onChangeInline('height', v)} placeholder="auto" />
      </Row>
      <Row label="Min W/H">
        <NumberInput value={styles.minWidth}  onChange={v => onChangeInline('min-width', v)}  placeholder="none" />
        <NumberInput value={styles.minHeight} onChange={v => onChangeInline('min-height', v)} placeholder="none" />
      </Row>
      <Row label="Max W/H">
        <NumberInput value={styles.maxWidth}  onChange={v => onChangeInline('max-width', v)}  placeholder="none" />
        <NumberInput value={styles.maxHeight} onChange={v => onChangeInline('max-height', v)} placeholder="none" />
      </Row>
    </div>
  );
}

// ─── TypographyControls ───────────────────────────────────────────────────────

const FONT_WEIGHT_OPTS = [
  { label: '100', value: '100' }, { label: '200', value: '200' }, { label: '300', value: '300' },
  { label: '400', value: '400' }, { label: '500', value: '500' }, { label: '600', value: '600' },
  { label: '700', value: '700' }, { label: '800', value: '800' }, { label: '900', value: '900' },
];
const TEXT_ALIGN_OPTS = [
  { label: '⇤', value: 'left',    title: 'Left' },
  { label: '⇔', value: 'center',  title: 'Center' },
  { label: '⇥', value: 'right',   title: 'Right' },
  { label: '⇹', value: 'justify', title: 'Justify' },
];
const TEXT_TRANSFORM_OPTS = [
  { label: 'Aa', value: 'none',       title: 'None' },
  { label: 'AA', value: 'uppercase',  title: 'Uppercase' },
  { label: 'aa', value: 'lowercase',  title: 'Lowercase' },
  { label: 'Aa', value: 'capitalize', title: 'Capitalize' },
];

function TypographyControls({ styles, tokens, textVal, textProp, onChangeInline, onChangeToken, onSave }: {
  styles: ElementStyles | null;
  tokens: TokenEntry[];
  textVal: string; textProp: string;
  onChangeInline: (prop: string, value: string) => void;
  onChangeToken: (prop: string, value: string) => void;
  onSave: (prop: string, value: string) => void;
}) {
  if (!styles) return null;

  const isBold      = styles.textDecoration?.includes('underline');
  const isStrike    = styles.textDecoration?.includes('line-through');

  return (
    <div>
      <Row label="Color">
        <TokenField value={textVal} tokens={tokens} filter="color" onChange={v => onChangeToken(textProp, v)} />
        <button onClick={() => onSave(textProp, textVal)} title="Save to global.css"
          style={{ ...sIconBtn, color: '#6e7681' }}>↗</button>
      </Row>
      <Row label="Size">
        <NumberInput value={styles.fontSize} onChange={v => onChangeInline('font-size', v)} min={1} />
        <SelectInput value={styles.fontWeight} options={FONT_WEIGHT_OPTS} onChange={v => onChangeInline('font-weight', v)} />
      </Row>
      <Row label="Line H">
        <NumberInput value={styles.lineHeight === 'normal' ? '' : styles.lineHeight} onChange={v => onChangeInline('line-height', v)} suffix="" placeholder="normal" />
        <NumberInput value={styles.letterSpacing === 'normal' ? '' : styles.letterSpacing} onChange={v => onChangeInline('letter-spacing', v)} suffix="px" placeholder="0" />
      </Row>
      <Row label="Align">
        <div style={{ display: 'flex', gap: 3 }}>
          {TEXT_ALIGN_OPTS.map(o => (
            <IconBtn key={o.value} active={styles.textAlign === o.value} onClick={() => onChangeInline('text-align', o.value)} title={o.title}>
              {o.label}
            </IconBtn>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          <IconBtn active={isBold} onClick={() => onChangeInline('text-decoration', isBold ? 'none' : 'underline')} title="Underline">U̲</IconBtn>
          <IconBtn active={isStrike} onClick={() => onChangeInline('text-decoration', isStrike ? 'none' : 'line-through')} title="Strikethrough">S̶</IconBtn>
        </div>
      </Row>
      <Row label="Transform">
        <div style={{ display: 'flex', gap: 3 }}>
          {TEXT_TRANSFORM_OPTS.map(o => (
            <IconBtn key={o.value} active={styles.textTransform === o.value} onClick={() => onChangeInline('text-transform', o.value)} title={o.title}>
              {o.label}
            </IconBtn>
          ))}
        </div>
      </Row>
    </div>
  );
}

// ─── BorderControls ───────────────────────────────────────────────────────────

const BORDER_STYLE_OPTS = [
  { label: 'none',   value: 'none' },
  { label: 'solid',  value: 'solid' },
  { label: 'dashed', value: 'dashed' },
  { label: 'dotted', value: 'dotted' },
  { label: 'double', value: 'double' },
];

function BorderControls({ styles, tokens, strokeVal, strokeProp, onChangeInline, onChangeToken, onSave }: {
  styles: ElementStyles | null;
  tokens: TokenEntry[];
  strokeVal: string; strokeProp: string;
  onChangeInline: (prop: string, value: string) => void;
  onChangeToken: (prop: string, value: string) => void;
  onSave: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  const [splitCorners, setSplitCorners] = useState(false);

  const allSame =
    styles.borderTopLeftRadius === styles.borderTopRightRadius &&
    styles.borderTopRightRadius === styles.borderBottomRightRadius &&
    styles.borderBottomRightRadius === styles.borderBottomLeftRadius;

  return (
    <div>
      <Row label="Color">
        <TokenField value={strokeVal} tokens={tokens} filter="color" onChange={v => onChangeToken(strokeProp, v)} />
        <button onClick={() => onSave(strokeProp, strokeVal)} title="Save to global.css"
          style={{ ...sIconBtn, color: '#6e7681' }}>↗</button>
      </Row>
      <Row label="Width">
        <NumberInput value={styles.borderWidth} onChange={v => onChangeInline('border-width', v)} min={0} />
        <SelectInput value={styles.borderStyle} options={BORDER_STYLE_OPTS} onChange={v => onChangeInline('border-style', v)} />
      </Row>
      <Row label="Radius">
        <NumberInput
          value={allSame ? styles.borderTopLeftRadius : '—'}
          onChange={v => onChangeInline('border-radius', v)} min={0}
          placeholder="mixed" />
        <button onClick={() => setSplitCorners(s => !s)} title="Per-corner radius"
          style={{ ...sIconBtn, color: splitCorners ? '#58a6ff' : '#6e7681', border: '1px solid ' + (splitCorners ? '#58a6ff' : '#30363d'), borderRadius: 4, padding: '2px 5px', fontSize: 10 }}>
          ⌗
        </button>
      </Row>
      {(splitCorners || !allSame) && (
        <Row>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1 }}>
            {([
              ['border-top-left-radius',     styles.borderTopLeftRadius,     'TL'],
              ['border-top-right-radius',    styles.borderTopRightRadius,    'TR'],
              ['border-bottom-left-radius',  styles.borderBottomLeftRadius,  'BL'],
              ['border-bottom-right-radius', styles.borderBottomRightRadius, 'BR'],
            ] as [string, string, string][]).map(([prop, val, label]) => (
              <div key={prop} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 9, color: '#6e7681', width: 14 }}>{label}</span>
                <NumberInput value={val} onChange={v => onChangeInline(prop, v)} min={0} />
              </div>
            ))}
          </div>
        </Row>
      )}
    </div>
  );
}

// ─── EffectsControls ──────────────────────────────────────────────────────────

function OpacitySlider({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pct = Math.round(parseFloat(value) * 100);
  return (
    <Row label="Opacity">
      <input type="range" min={0} max={100} value={pct}
        onChange={e => onChange((parseInt(e.target.value) / 100).toString())}
        style={{ flex: 1, accentColor: '#58a6ff', cursor: 'pointer' }} />
      <span style={{ width: 34, textAlign: 'right', fontSize: 11, color: '#8b949e', flexShrink: 0 }}>{pct}%</span>
    </Row>
  );
}

// ─── ClassesBar ───────────────────────────────────────────────────────────────

function ClassesBar({ classList, selectedPath, channel }: {
  classList: string; selectedPath: number[]; channel: ReturnType<typeof addons.getChannel>;
}) {
  const [adding, setAdding] = useState(false);
  const [newCls, setNewCls] = useState('');
  const classes = classList ? classList.split(/\s+/).filter(Boolean) : [];

  const addCls = () => {
    const trimmed = newCls.trim();
    if (trimmed) {
      channel.emit('DESIGN/ADD_CLASS', { path: selectedPath, cls: trimmed });
      setNewCls('');
    }
    setAdding(false);
  };

  return (
    <div style={{ padding: '6px 12px 8px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {classes.map(cls => (
          <div key={cls} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: '#21262d', borderRadius: 3, padding: '2px 6px',
            fontSize: 10, color: '#c9d1d9', fontFamily: 'monospace',
          }}>
            <span>{cls}</span>
            <button onClick={() => channel.emit('DESIGN/REMOVE_CLASS', { path: selectedPath, cls })}
              style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', padding: 0, fontSize: 10, lineHeight: 1 }}>×</button>
          </div>
        ))}
        {adding ? (
          <input
            autoFocus
            value={newCls}
            onChange={e => setNewCls(e.target.value)}
            onBlur={addCls}
            onKeyDown={e => { if (e.key === 'Enter') addCls(); if (e.key === 'Escape') { setAdding(false); setNewCls(''); } }}
            placeholder="class-name"
            style={{
              background: '#0d1117', border: '1px solid #58a6ff', borderRadius: 3,
              color: '#c9d1d9', fontSize: 10, padding: '2px 6px', outline: 'none',
              fontFamily: 'monospace', width: 100,
            }}
          />
        ) : (
          <button onClick={() => setAdding(true)}
            style={{ background: 'none', border: '1px dashed #30363d', borderRadius: 3, color: '#6e7681', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
            + class
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ComponentVariants ────────────────────────────────────────────────────────

function ComponentVariants({ storyId, channel, selectedPath }: {
  storyId: string;
  channel: ReturnType<typeof addons.getChannel>;
  selectedPath: number[];
}) {
  const [variants, setVariants] = useState<Record<string, string[]>>({});
  const [active,   setActive]   = useState<Record<string, string>>({});

  useEffect(() => {
    if (!storyId) return;
    fetch(`${API_BASE}/api/component-variants?storyId=${encodeURIComponent(storyId)}`)
      .then(r => r.json())
      .then((d: { variants?: Record<string, string[]> }) => { if (d.variants) setVariants(d.variants); })
      .catch(() => {});
  }, [storyId]);

  const keys = Object.keys(variants);
  if (keys.length === 0) return null;

  const applyVariant = (varName: string, val: string) => {
    const prev = active[varName];
    // Remove old variant class if any, add new one
    if (prev) channel.emit('DESIGN/REMOVE_CLASS', { path: selectedPath, cls: prev });
    // For CVA, the classes are applied via story args (variant prop), not raw classes.
    // We emit a story-arg update via the channel for immediate visual feedback.
    channel.emit('DESIGN/SET_STORY_ARG', { prop: varName, value: val });
    setActive(a => ({ ...a, [varName]: val }));
  };

  return (
    <div>
      {keys.map(varName => (
        <div key={varName} style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{varName}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {variants[varName].map(val => (
              <button key={val} onClick={() => applyVariant(varName, val)}
                style={{
                  padding: '2px 8px', border: '1px solid ' + (active[varName] === val ? '#1f6feb' : '#30363d'),
                  borderRadius: 3, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
                  background: active[varName] === val ? '#1f3a5f' : 'transparent',
                  color: active[varName] === val ? '#58a6ff' : '#8b949e',
                }}>
                {val}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ComboClasses ─────────────────────────────────────────────────────────────

function ComboClasses({ storyId, classList, selectedPath, channel }: {
  storyId: string;
  classList: string;
  selectedPath: number[];
  channel: ReturnType<typeof addons.getChannel>;
}) {
  const [combos,    setCombos]    = useState<Record<string, string>>({});
  const [naming,    setNaming]    = useState(false);
  const [comboName, setComboName] = useState('');
  const [active,    setActive]    = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) return;
    fetch(`${API_BASE}/api/combo-classes?storyId=${encodeURIComponent(storyId)}`)
      .then(r => r.json())
      .then((d: { combos?: Record<string, string> }) => { if (d.combos) setCombos(d.combos); })
      .catch(() => {});
  }, [storyId]);

  const saveCombo = async () => {
    const name = comboName.trim();
    if (!name || !classList) return;
    const next = { ...combos, [name]: classList };
    setCombos(next);
    setNaming(false);
    setComboName('');
    await fetch(`${API_BASE}/api/combo-classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId, combos: next }),
    }).catch(() => {});
  };

  const applyCombo = (name: string) => {
    const cls = combos[name];
    if (!cls) return;
    if (active === name) {
      // Deactivate — remove those classes
      cls.split(/\s+/).filter(Boolean).forEach(c => channel.emit('DESIGN/REMOVE_CLASS', { path: selectedPath, cls: c }));
      setActive(null);
    } else {
      // Apply
      channel.emit('DESIGN/ADD_CLASS', { path: selectedPath, cls });
      setActive(name);
    }
  };

  const deleteCombo = async (name: string) => {
    const next = { ...combos };
    delete next[name];
    setCombos(next);
    if (active === name) setActive(null);
    await fetch(`${API_BASE}/api/combo-classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId, combos: next }),
    }).catch(() => {});
  };

  return (
    <div style={{ padding: '6px 12px 8px' }}>
      <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Combo Classes</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {Object.keys(combos).map(name => (
          <div key={name} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: active === name ? '#1f3a5f' : '#21262d',
            border: '1px solid ' + (active === name ? '#1f6feb' : '#30363d'),
            borderRadius: 3, padding: '2px 6px',
            fontSize: 10, color: active === name ? '#58a6ff' : '#c9d1d9', cursor: 'pointer',
          }}>
            <span onClick={() => applyCombo(name)} title={combos[name]}>{name}</span>
            <button onClick={() => deleteCombo(name)}
              style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', padding: 0, fontSize: 10, lineHeight: 1 }}>×</button>
          </div>
        ))}
        {naming ? (
          <input
            autoFocus value={comboName}
            onChange={e => setComboName(e.target.value)}
            onBlur={saveCombo}
            onKeyDown={e => { if (e.key === 'Enter') saveCombo(); if (e.key === 'Escape') { setNaming(false); setComboName(''); } }}
            placeholder="combo name…"
            style={{
              background: '#0d1117', border: '1px solid #58a6ff', borderRadius: 3,
              color: '#c9d1d9', fontSize: 10, padding: '2px 6px', outline: 'none',
              fontFamily: 'monospace', width: 90,
            }}
          />
        ) : (
          <button onClick={() => setNaming(true)} title="Save current classes as a combo"
            style={{ background: 'none', border: '1px dashed #30363d', borderRadius: 3, color: '#6e7681', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
            + save combo
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Shared icon-button style (used in new sections) ──────────────────────────
const sIconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1, fontFamily: 'inherit',
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function DesignPanel({ active }: { active: boolean }) {
  const api     = useStorybookApi();
  const channel = addons.getChannel();

  const [tokens,     setTokens]     = useState<TokenEntry[]>([]);
  const [tree,       setTree]       = useState<TreeNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<number[]>([]);
  const [styles,     setStyles]     = useState<ElementStyles | null>(null);
  const [overrides,  setOverrides]  = useState<Array<{ prop: string; value: string }>>([]);
  const [saved,      setSaved]      = useState<string | null>(null);
  const [layerNames, setLayerNames] = useState<Record<string, string>>({});

  // ── Pending code changes ─────────────────────────────────────────────────────
  const [pendingText, setPendingText] = useState<{ path: number[]; prop: string; value: string } | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [saveReport,  setSaveReport]  = useState<{ entries: { label: string; file: string; ok: boolean }[] } | null>(null);
  const [savedCount,  setSavedCount]  = useState(0);

  // ── Add-variant form state ────────────────────────────────────────────────────
  const [variantOpen,   setVariantOpen]   = useState(false);
  const [variantName,   setVariantName]   = useState('');
  const [variantStatus, setVariantStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [variantError,  setVariantError]  = useState('');

  // ── PR form state ─────────────────────────────────────────────────────────────
  const [prOpen,    setPrOpen]    = useState(false);
  const [prTitle,   setPrTitle]   = useState('');
  const [prBody,    setPrBody]    = useState('');
  const [prLoading, setPrLoading] = useState(false);
  const [prResult,  setPrResult]  = useState<{ url?: string; error?: string } | null>(null);

  const storyData = api.getCurrentStoryData();
  const storyId   = storyData?.id ?? '';

  // Keep a ref to overrides so the story-switch effect can re-apply without
  // being a reactive dep (avoids infinite re-run loop).
  const overridesRef = useRef(overrides);
  useEffect(() => { overridesRef.current = overrides; });

  // Track whether we've already done a first-load reset this browser session.
  // The manager iframe survives Storybook server restarts (WS reconnect, no
  // reload), so React state — including stale overrides — persists.  We clear
  // them once on the very first story load so stale saves can't corrupt tokens.
  const didInitRef = useRef(false);

  // ── Load all tokens, then re-resolve colors via the browser ─────────────────
  // The server converts oklch→hex with its own math which can differ slightly
  // from what the browser renders.  After loading, we ask the preview iframe to
  // resolve each CSS var through getComputedStyle so token matching is exact.
  useEffect(() => {
    fetch(`${API_BASE}/api/tokens`)
      .then(r => r.json())
      .then((raw: TokenEntry[]) => {
        setTokens(raw);
        const colorNames = raw
          .filter(t => t.type === 'color')
          .map(t => t.name);
        if (colorNames.length > 0) {
          channel.emit('DESIGN/RESOLVE_TOKENS', colorNames);
        }
      })
      .catch(() => {});
  }, []);

  // Patch token resolved values once the preview iframe returns browser-resolved hex.
  useEffect(() => {
    const handler = (browserResolved: Record<string, string>) => {
      setTokens(prev => prev.map(t => {
        const br = browserResolved[t.name];
        return br ? { ...t, resolved: br } : t;
      }));
    };
    channel.on('DESIGN/RESOLVED_TOKENS', handler);
    return () => { channel.off('DESIGN/RESOLVED_TOKENS', handler); };
  }, [channel]);

  // ── Build tree & inspect root when story changes ─────────────────────────
  useEffect(() => {
    if (!active || !storyId) return;
    setTree(null);
    setSelectedId(null);
    setSelectedPath([]);
    setStyles(null);
    setLayerNames({});
    setPendingText(null);
    setSaveReport(null);
    setVariantOpen(false);
    setVariantName('');
    setVariantStatus('idle');

    // Load persisted layer-name annotations for this story
    fetch(`${API_BASE}/api/layer-names?storyId=${storyId}`)
      .then(r => r.json())
      .then((d: { layerNames?: Record<string, string> }) => {
        if (d.layerNames && Object.keys(d.layerNames).length > 0) {
          setLayerNames(d.layerNames);
        }
      })
      .catch(() => {});

    // On the very first story shown in this browser session, clear any stale
    // overrides that survived a server restart via WS reconnect.
    if (!didInitRef.current) {
      didInitRef.current = true;
      setOverrides([]);
      channel.emit('DESIGN/RESET_ALL');
    }

    const t = setTimeout(() => {
      channel.emit('DESIGN/BUILD_TREE');
      channel.emit('DESIGN/INSPECT');
      // Re-apply any active token overrides to the newly loaded story
      const cur = overridesRef.current;
      if (cur.length > 0) {
        const map: Record<string, string> = {};
        cur.forEach(o => { map[o.prop] = o.value; });
        channel.emit('DESIGN/APPLY', map);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [active, storyId, channel]);

  useEffect(() => {
    const onTree   = (t: TreeNode | null) => setTree(t);
    const onStyles = (s: ElementStyles | null) => setStyles(s);
    channel.on('DESIGN/TREE',   onTree);
    channel.on('DESIGN/STYLES', onStyles);
    return () => { channel.off('DESIGN/TREE', onTree); channel.off('DESIGN/STYLES', onStyles); };
  }, [channel]);

  // ── Layer selection ─────────────────────────────────────────────────────────
  const selectLayer = useCallback((node: TreeNode) => {
    setSelectedId(node.id);
    setSelectedPath(node.path);
    channel.emit(node.path.length === 0 ? 'DESIGN/INSPECT' : 'DESIGN/SELECT_LAYER', node.path);
  }, [channel]);

  // ── Save to Code ─────────────────────────────────────────────────────────────
  const saveToCode = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveReport(null);
    const entries: { label: string; file: string; ok: boolean }[] = [];

    // 1. Token overrides → global.css
    for (const o of overrides) {
      try {
        await fetch(`${API_BASE}/api/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: o.prop, value: o.value }),
        });
        entries.push({ label: `${o.prop}: ${o.value}`, file: 'app/globals.css', ok: true });
      } catch {
        entries.push({ label: o.prop, file: 'app/globals.css', ok: false });
      }
    }

    // 2. Text / story-arg change → story file
    if (pendingText) {
      try {
        const res = await fetch(`${API_BASE}/api/story-args`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId, prop: pendingText.prop, value: pendingText.value }),
        });
        const data = await res.json() as { ok?: boolean; file?: string; error?: string };
        if (data.ok) {
          entries.push({ label: `${pendingText.prop}: "${pendingText.value}"`, file: data.file ?? 'story', ok: true });
          setPendingText(null);
        } else {
          entries.push({ label: pendingText.prop, file: data.error ?? 'story', ok: false });
        }
      } catch {
        entries.push({ label: pendingText.prop, file: 'story', ok: false });
      }
    }

    // 3. Layer name annotations → .stories.meta.json
    if (Object.keys(layerNames).length > 0) {
      try {
        const r = await fetch(`${API_BASE}/api/layer-names`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId, layerNames }),
        });
        const d = await r.json() as { ok?: boolean; file?: string; error?: string };
        entries.push({ label: `Layer names (${Object.keys(layerNames).length})`, file: d.file ?? 'meta', ok: !!d.ok });
      } catch {
        entries.push({ label: 'Layer names', file: 'meta', ok: false });
      }
    }

    setSaving(false);
    setSaveReport({ entries });

    // After a successful save: clear the overrides state so the badge resets,
    // but keep the INLINE overrides alive briefly so there is no visual flash
    // between the save and Vite's CSS HMR replacing the stylesheet value.
    if (entries.every(e => e.ok)) {
      setSavedCount(c => c + entries.length);
      setOverrides([]);
      // Give Vite ~1.5 s to HMR the CSS file; then clear the redundant inline
      // overrides (by then the stylesheet value matches, so no visual change).
      setTimeout(() => channel.emit('DESIGN/RESET_ALL'), 1500);
    }
  }, [saving, overrides, pendingText, storyId, channel]);

  // ── Layer rename ─────────────────────────────────────────────────────────────
  const renameLayer = useCallback((id: string, name: string) => {
    setLayerNames(prev => {
      const next = { ...prev };
      if (name) next[id] = name; else delete next[id];
      return next;
    });
  }, []);

  // ── Token overrides ─────────────────────────────────────────────────────────
  const applyOverride = useCallback((prop: string, value: string) => {
    setOverrides(prev => { const n = prev.filter(o => o.prop !== prop); if (value) n.push({ prop, value }); return n; });
    channel.emit('DESIGN/APPLY', { [prop]: value });
  }, [channel]);

  const removeOverride = useCallback((prop: string) => {
    setOverrides(prev => prev.filter(o => o.prop !== prop));
    channel.emit('DESIGN/RESET_PROP', prop);
  }, [channel]);

  const resetAll = useCallback(() => {
    setOverrides([]);
    channel.emit('DESIGN/RESET_ALL');
  }, [channel]);

  const saveToFile = useCallback(async (prop: string, value: string) => {
    await fetch(`${API_BASE}/api/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: prop, value }) }).catch(() => {});
    setSaved(prop);
    setSavedCount(c => c + 1);
    setTimeout(() => setSaved(null), 2000);
  }, []);

  // ── Inline style changes (non-token, direct property on element) ─────────────
  const applyInlineStyle = useCallback((prop: string, value: string) => {
    channel.emit('DESIGN/SET_INLINE_STYLE', { path: selectedPath, prop, value });
  }, [channel, selectedPath]);

  // ── Submit PR ──────────────────────────────────────────────────────────────
  const submitPR = useCallback(async () => {
    if (!prTitle.trim() || prLoading) return;
    setPrLoading(true);
    setPrResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/create-pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: prTitle.trim(), body: prBody.trim() }),
      });
      const data = await res.json() as { ok?: boolean; url?: string; error?: string };
      if (data.ok && data.url) {
        setPrResult({ url: data.url });
        setSavedCount(0); // reset badge after successful PR
      } else {
        setPrResult({ error: data.error ?? 'Unknown error' });
      }
    } catch (e) {
      setPrResult({ error: String(e) });
    } finally {
      setPrLoading(false);
    }
  }, [prTitle, prBody, prLoading]);

  // ── Add story variant ──────────────────────────────────────────────────────
  const addVariant = useCallback(async () => {
    if (!variantName.trim() || variantStatus === 'loading') return;
    setVariantStatus('loading');
    setVariantError('');
    try {
      const res = await fetch(`${API_BASE}/api/add-story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, name: variantName.trim() }),
      });
      const d = await res.json() as { ok?: boolean; exportName?: string; error?: string };
      if (d.ok) {
        setVariantStatus('done');
        setVariantName('');
        setTimeout(() => { setVariantStatus('idle'); setVariantOpen(false); }, 1800);
      } else {
        setVariantError(d.error ?? 'Unknown error');
        setVariantStatus('error');
      }
    } catch (e) {
      setVariantError(String(e));
      setVariantStatus('error');
    }
  }, [variantName, variantStatus, storyId]);

  if (!active) return null;

  // ── Resolve style values to tokens ─────────────────────────────────────────
  const fillEntry   = styles ? findToken(tokens, styles.backgroundColor, styles.bgToken     || undefined) : undefined;
  const strokeEntry = styles ? findToken(tokens, styles.borderColor,     styles.borderToken || undefined) : undefined;
  const textEntry   = styles ? findToken(tokens, styles.color,           styles.textToken   || undefined) : undefined;

  // Use the ACTUAL detected token as the override target — not generic fallbacks.
  // This ensures live changes affect the correct CSS var (e.g. --blue-50 for
  // Button fill) rather than a global semantic name that may not apply.
  const fillProp   = fillEntry?.name   ?? '--bg-primary';
  const strokeProp = strokeEntry?.name ?? '--border-primary';
  const textProp   = textEntry?.name   ?? '--content-primary';

  const fillVal   = overrides.find(o => o.prop === fillProp)?.value   ?? (fillEntry ? `var(${fillEntry.name})` : styles?.backgroundColor ?? '');
  const strokeVal = overrides.find(o => o.prop === strokeProp)?.value ?? (strokeEntry ? `var(${strokeEntry.name})` : styles?.borderColor ?? '');
  const textVal   = overrides.find(o => o.prop === textProp)?.value   ?? (textEntry ? `var(${textEntry.name})` : styles?.color ?? '');

  const componentName = storyData
    ? storyData.id.split('--')[0].split('-').map((w: string) => w[0]?.toUpperCase() + w.slice(1)).join(' ')
    : '—';

  const SaveBtn = ({ prop, value }: { prop: string; value: string }) => (
    <button onClick={() => saveToFile(prop, value)} title="Save to global.css"
      style={{ ...s.iconBtn, color: saved === prop ? '#3fb950' : '#6e7681' }}>
      {saved === prop ? '✓' : '↗'}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1b1c1d', color: '#c9d1d9', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: 12, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {(() => {
        const pendingCount = overrides.length + (pendingText ? 1 : 0);
        return (
          <div style={{ borderBottom: '1px solid #30363d', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#e6edf3' }}>{componentName}</div>
                  {storyId && (
                    <button
                      onClick={() => { setVariantOpen(o => !o); setVariantStatus('idle'); setVariantError(''); }}
                      title="Add a new story variant"
                      style={{ background: 'none', border: '1px dashed #30363d', borderRadius: 3, color: '#6e7681', fontSize: 10, padding: '1px 5px', cursor: 'pointer', lineHeight: 1.4 }}>
                      ＋
                    </button>
                  )}
                </div>
                {/* Always show component root size; add selected-layer size when a non-root layer is active */}
                {tree && (
                  <div style={{ fontSize: 10, color: '#6e7681', marginTop: 1 }}>
                    {tree.w}×{tree.h}px
                    {selectedId && selectedId !== 'root' && styles && (
                      <span style={{ marginLeft: 5, color: '#58a6ff' }}>· {styles.width}×{styles.height}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={resetAll} style={s.btn} title="Reset live overrides">Reset</button>
                <button onClick={() => { channel.emit('DESIGN/BUILD_TREE'); channel.emit('DESIGN/INSPECT'); setSelectedId(null); setSaveReport(null); }} style={s.btn} title="Refresh">↺</button>
                <button
                  onClick={saveToCode}
                  disabled={saving || pendingCount === 0}
                  title={pendingCount === 0 ? 'No pending changes' : `Save ${pendingCount} change${pendingCount > 1 ? 's' : ''} to source files`}
                  style={{
                    ...s.btn,
                    background: pendingCount > 0 ? '#238636' : 'transparent',
                    color:      pendingCount > 0 ? '#fff'     : '#6e7681',
                    borderColor: pendingCount > 0 ? '#2ea043' : '#30363d',
                    opacity: saving ? 0.6 : 1,
                    position: 'relative',
                  }}>
                  {saving ? '…' : '↑ Save'}
                  {pendingCount > 0 && !saving && (
                    <span style={{ marginLeft: 4, background: '#f0883e', color: '#fff', borderRadius: 8, fontSize: 9, padding: '1px 5px', fontWeight: 700 }}>{pendingCount}</span>
                  )}
                </button>
                {savedCount > 0 && (
                  <button
                    onClick={() => { setPrOpen(o => !o); setPrResult(null); }}
                    title="Submit saved changes as a GitHub Pull Request"
                    style={{
                      ...s.btn,
                      background: prOpen ? '#6e40c9' : 'transparent',
                      color:      prOpen ? '#fff'     : '#a371f7',
                      borderColor: '#6e40c9',
                    }}>
                    ⤴ PR
                  </button>
                )}
              </div>
            </div>

            {/* ── Add variant form ──────────────────────────────────────── */}
            {variantOpen && (
              <div style={{ borderTop: '1px solid #21262d', padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 5 }}>New story variant — copies current args</div>
                {variantStatus === 'done' ? (
                  <div style={{ color: '#3fb950', fontSize: 11 }}>✓ Added — Storybook will reload automatically</div>
                ) : (
                  <>
                    {variantStatus === 'error' && (
                      <div style={{ color: '#f85149', fontSize: 10, marginBottom: 5 }}>{variantError}</div>
                    )}
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input
                        autoFocus
                        placeholder='Variant name, e.g. "Dark" or "Large"'
                        value={variantName}
                        onChange={e => setVariantName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addVariant(); if (e.key === 'Escape') setVariantOpen(false); }}
                        style={{ flex: 1, padding: '4px 7px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button
                        disabled={!variantName.trim() || variantStatus === 'loading'}
                        onClick={addVariant}
                        style={{ ...s.btn, background: variantName.trim() ? '#238636' : 'transparent', color: variantName.trim() ? '#fff' : '#6e7681', borderColor: variantName.trim() ? '#2ea043' : '#30363d' }}>
                        {variantStatus === 'loading' ? '…' : 'Add'}
                      </button>
                      <button onClick={() => setVariantOpen(false)} style={s.btn}>✕</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Save report ───────────────────────────────────────────── */}
            {saveReport && (
              <div style={{ borderTop: '1px solid #21262d', padding: '6px 12px', fontSize: 11 }}>
                {saveReport.entries.length === 0 ? (
                  <span style={{ color: '#6e7681' }}>Nothing to save.</span>
                ) : (
                  <>
                    {saveReport.entries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 3 }}>
                        <span style={{ color: e.ok ? '#3fb950' : '#f85149', flexShrink: 0, lineHeight: 1.4 }}>{e.ok ? '✓' : '✗'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: e.ok ? '#c9d1d9' : '#f85149', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                          <div style={{ color: '#6e7681', fontSize: 10, fontFamily: 'monospace' }}>{e.file}</div>
                        </div>
                      </div>
                    ))}
                    {saveReport.entries.every(e => e.ok) && (
                      <div style={{ color: '#3fb950', marginTop: 4, fontSize: 10 }}>All changes saved to source. Ready to commit.</div>
                    )}
                  </>
                )}
                <button onClick={() => setSaveReport(null)} style={{ marginTop: 4, background: 'none', border: 'none', color: '#6e7681', fontSize: 10, cursor: 'pointer', padding: 0 }}>dismiss</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── PR Drawer ───────────────────────────────────────────────────── */}
      {prOpen && (
        <div style={{ borderBottom: '1px solid #30363d', background: '#161b22', padding: '10px 12px', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a371f7', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Create Pull Request
          </div>

          {prResult?.url ? (
            /* ── Success ── */
            <div>
              <div style={{ color: '#3fb950', fontSize: 11, marginBottom: 6 }}>✓ PR created successfully!</div>
              <a href={prResult.url} target="_blank" rel="noreferrer"
                style={{ color: '#58a6ff', fontSize: 11, wordBreak: 'break-all', display: 'block', marginBottom: 8 }}>
                {prResult.url}
              </a>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => window.open(prResult.url, '_blank')}
                  style={{ ...s.btn, flex: 1, background: '#238636', color: '#fff', borderColor: '#2ea043' }}>
                  Open PR ↗
                </button>
                <button onClick={() => { setPrOpen(false); setPrResult(null); setPrTitle(''); setPrBody(''); }}
                  style={s.btn}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            /* ── Form ── */
            <>
              {prResult?.error && (
                <div style={{ background: '#3d1a1a', border: '1px solid #6e1a1a', borderRadius: 4, padding: '6px 8px', color: '#f85149', fontSize: 11, marginBottom: 8 }}>
                  {prResult.error}
                </div>
              )}
              <input
                placeholder="PR title — e.g. Update primary brand color to indigo"
                value={prTitle}
                onChange={e => setPrTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitPR(); }}
                style={{ width: '100%', padding: '5px 8px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
              />
              <textarea
                placeholder="Description (optional) — what changed and why"
                value={prBody}
                onChange={e => setPrBody(e.target.value)}
                rows={2}
                style={{ marginTop: 5, width: '100%', padding: '5px 8px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  disabled={!prTitle.trim() || prLoading}
                  onClick={submitPR}
                  style={{
                    flex: 1,
                    background: prTitle.trim() && !prLoading ? '#6e40c9' : '#21262d',
                    border: 'none', borderRadius: 4,
                    color: prTitle.trim() && !prLoading ? '#fff' : '#6e7681',
                    padding: '6px', cursor: prTitle.trim() && !prLoading ? 'pointer' : 'default',
                    fontSize: 11, fontFamily: 'inherit',
                  }}>
                  {prLoading ? 'Creating PR…' : '⤴ Create PR'}
                </button>
                <button onClick={() => { setPrOpen(false); setPrResult(null); }} style={s.btn}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: '#6e7681' }}>
                Requires <code style={{ background: '#21262d', padding: '1px 4px', borderRadius: 3 }}>GITHUB_TOKEN</code> in <code style={{ background: '#21262d', padding: '1px 4px', borderRadius: 3 }}>.env.local</code>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* LAYERS */}
        <Section label="Layers" noPad>
          {tree ? (
            <LayerRow node={tree} depth={0} selectedId={selectedId}
              layerNames={layerNames} onSelect={selectLayer} onRename={renameLayer} />
          ) : (
            <div style={{ padding: '8px 12px', color: '#6e7681', fontSize: 11 }}>
              {storyId ? 'Building layer tree…' : 'Select a story'}
            </div>
          )}
        </Section>

        {/* CLASSES + COMBOS */}
        {styles && (
          <Section label="Classes" noPad>
            <ClassesBar classList={styles.classList ?? ''} selectedPath={selectedPath} channel={channel} />
            <ComboClasses storyId={storyId} classList={styles.classList ?? ''} selectedPath={selectedPath} channel={channel} />
          </Section>
        )}

        {/* COMPONENT VARIANTS */}
        {storyId && (
          <Section label="Variants" defaultOpen={true}>
            <ComponentVariants storyId={storyId} channel={channel} selectedPath={selectedPath} />
          </Section>
        )}

        {/* LAYOUT */}
        <Section label="Layout" defaultOpen={true}>
          <LayoutControls styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* SIZE */}
        <Section label="Size" defaultOpen={true}>
          <SizeControls styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* SPACING */}
        <Section label="Spacing" defaultOpen={true}>
          <SpacingBox styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* FILL */}
        <Section label="Fill">
          <Row>
            <TokenField value={fillVal} tokens={tokens} filter="color" onChange={v => applyOverride(fillProp, v)} />
            <SaveBtn prop={fillProp} value={fillVal} />
          </Row>
        </Section>

        {/* TYPOGRAPHY */}
        <Section label="Typography" defaultOpen={false}>
          <TypographyControls
            styles={styles} tokens={tokens}
            textVal={textVal} textProp={textProp}
            onChangeInline={applyInlineStyle}
            onChangeToken={applyOverride}
            onSave={saveToFile}
          />
          {styles?.leafText !== undefined && styles.leafText !== '' && (
            <Row label="Text">
              <input
                defaultValue={styles.leafText}
                key={styles.leafText}
                onChange={e => {
                  const text = (e.target as HTMLInputElement).value;
                  channel.emit('DESIGN/SET_TEXT', { path: selectedPath, text });
                  setPendingText({ path: selectedPath, prop: 'children', value: text });
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const text = (e.target as HTMLInputElement).value;
                    channel.emit('DESIGN/SET_TEXT', { path: selectedPath, text });
                    setPendingText({ path: selectedPath, prop: 'children', value: text });
                  }
                }}
                style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '3px 7px', outline: 'none', fontFamily: 'inherit' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#58a6ff'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#30363d'}
              />
              {pendingText && <span style={{ color: '#f0883e', fontSize: 9, flexShrink: 0 }}>●</span>}
            </Row>
          )}
        </Section>

        {/* BORDER */}
        <Section label="Border" defaultOpen={false}>
          <BorderControls
            styles={styles} tokens={tokens}
            strokeVal={strokeVal} strokeProp={strokeProp}
            onChangeInline={applyInlineStyle}
            onChangeToken={applyOverride}
            onSave={saveToFile}
          />
        </Section>

        {/* EFFECTS */}
        <Section label="Effects" defaultOpen={false}>
          {styles && (
            <>
              <OpacitySlider
                value={styles.opacity}
                onChange={v => applyInlineStyle('opacity', v)}
              />
              {styles.boxShadow && styles.boxShadow !== 'none' && (
                <Row label="Shadow">
                  <span style={{ fontSize: 10, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={styles.boxShadow}>
                    {styles.boxShadow.length > 32 ? styles.boxShadow.slice(0, 32) + '…' : styles.boxShadow}
                  </span>
                </Row>
              )}
              {styles.filter && styles.filter !== 'none' && (
                <Row label="Filter">
                  <span style={{ fontSize: 10, color: '#8b949e' }}>{styles.filter}</span>
                </Row>
              )}
            </>
          )}
        </Section>

        {/* TOKEN OVERRIDES */}
        <Section label="CSS Variables" defaultOpen={false}>
          {overrides.map(o => {
            const entry = tokens.find(t => t.name === o.prop);
            const filter = entry?.type === 'color' ? 'color' : entry?.type === 'size' ? 'size' : 'all';
            return (
              <div key={o.prop} style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 3 }}>{shortName(o.prop)}</div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <TokenField value={o.value} tokens={tokens} filter={filter} onChange={v => applyOverride(o.prop, v)} />
                  <button onClick={() => saveToFile(o.prop, o.value)} style={{ ...s.iconBtn, color: saved === o.prop ? '#3fb950' : '#6e7681' }} title="Save to global.css">{saved === o.prop ? '✓' : '↗'}</button>
                  <button onClick={() => removeOverride(o.prop)} style={{ ...s.iconBtn, color: '#6e7681' }} title="Remove">×</button>
                </div>
              </div>
            );
          })}
          <AddOverrideRow tokens={tokens} onAdd={(prop, value) => applyOverride(prop, value)} />
        </Section>

      </div>
    </div>
  );
}

// ─── Add Override Row ─────────────────────────────────────────────────────────

function AddOverrideRow({ tokens, onAdd }: { tokens: TokenEntry[]; onAdd: (prop: string, value: string) => void }) {
  const [open,    setOpen]    = useState(false);
  const [prop,    setProp]    = useState('');
  const [value,   setValue]   = useState('');
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ marginTop: 8, width: '100%', background: 'none', border: '1px dashed #30363d', borderRadius: 4, color: '#6e7681', fontSize: 11, padding: '5px 0', cursor: 'pointer' }}>
      + Add token override
    </button>
  );

  const entry = tokens.find(t => t.name === prop);

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div ref={anchor} onClick={() => setPicking(o => !o)}
        style={{ padding: '4px 8px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: prop ? '#c9d1d9' : '#6e7681', display: 'flex', alignItems: 'center', gap: 6 }}>
        {entry && isColorToken(entry) && <div style={{ ...tokenSwatch(entry.resolved) }} />}
        {prop ? shortName(prop) : 'Pick token to override…'}
        <span style={{ marginLeft: 'auto', color: '#6e7681', fontSize: 9 }}>▾</span>
      </div>
      {picking && (
        <TokenPicker tokens={tokens} filter="all" current={prop}
          onSelect={e => { if (e) setProp(e.name); setPicking(false); }}
          onClose={() => setPicking(false)}
          anchorRef={anchor as React.RefObject<HTMLElement>} />
      )}
      {prop && (
        <TokenField value={value} tokens={tokens} filter={entry?.type === 'color' ? 'color' : entry?.type === 'size' ? 'size' : 'all'} onChange={setValue} />
      )}
      <div style={{ display: 'flex', gap: 5 }}>
        <button disabled={!prop || !value}
          onClick={() => { onAdd(prop, value); setOpen(false); setProp(''); setValue(''); }}
          style={{ flex: 1, background: prop && value ? '#238636' : '#21262d', border: 'none', borderRadius: 4, color: prop && value ? '#fff' : '#6e7681', padding: '5px', cursor: prop && value ? 'pointer' : 'default', fontSize: 11 }}>
          Apply
        </button>
        <button onClick={() => { setOpen(false); setProp(''); setValue(''); }}
          style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', padding: '5px 10px', cursor: 'pointer', fontSize: 11 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  btn:     { padding: '3px 10px', background: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1, fontFamily: 'inherit' },
};
