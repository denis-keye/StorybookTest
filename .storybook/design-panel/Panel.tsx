import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { addons, useStorybookApi } from '@storybook/manager-api';
import type { TreeNode } from './preview';

// ─── Premium dark design tokens ──────────────────────────────────────────────
const SB = {
  bg:          '#161618',
  bgSecondary: '#26262a',
  bgHover:     '#2e2e34',
  border:      'rgba(255,255,255,0.07)',
  borderFocus: 'rgba(2,156,253,0.7)',
  text:        '#e8e8ed',
  textMuted:   'rgba(232,232,237,0.40)',
  accent:      '#029cfd',
  accentGlow:  'rgba(2,156,253,0.18)',
  accentText:  '#ffffff',
  success:     '#30d158',
  warn:        '#ffd60a',
  font:        '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono:        '"SF Mono", "Fira Code", monospace',
  radius:      '6px',
  radiusSm:    '4px',
  rowH:        26,
};

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
  const isHex = /^#[0-9a-f]{3,8}$/i.test(resolved.trim());
  const isRgb = /^rgba?\(/.test(resolved.trim());
  const isResolved = isHex || isRgb;
  return {
    width: 14, height: 14, borderRadius: 2, flexShrink: 0,
    background: isResolved
      ? resolved
      : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 6px)',
    border: '1px solid rgba(255,255,255,0.15)',
    opacity: isResolved ? 1 : 0.5,
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
      background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: 8,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
      fontFamily: SB.font, fontSize: 12,
    }}>
      <div style={{ padding: '7px 8px 5px', borderBottom: `1px solid ${SB.border}` }}>
        <input autoFocus placeholder="Search tokens…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', background: SB.bg, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, padding: '4px 8px', outline: 'none', fontFamily: SB.font }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div style={{ padding: '6px 10px 2px', fontSize: 10, fontWeight: 600, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{group}</div>
            {items.map(t => {
              const active = t.name === current || `var(${t.name})` === current;
              return (
                <div key={t.name} onClick={() => onSelect(t)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', cursor: 'pointer', background: active ? SB.accentGlow : 'transparent', transition: 'background 0.08s' }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = SB.bgHover; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {isColorToken(t) && <div style={{ ...tokenSwatch(t.resolved) }} />}
                  <span style={{ flex: 1, color: SB.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(t.name)}</span>
                  <span style={{ color: SB.textMuted, fontFamily: SB.mono, fontSize: 10, flexShrink: 0 }}>{t.resolved}</span>
                </div>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: 12, color: SB.textMuted, textAlign: 'center' }}>No tokens match</div>}
      </div>

      <div style={{ borderTop: `1px solid ${SB.border}`, padding: '5px 8px' }}>
        {rawMode ? (
          <div style={{ display: 'flex', gap: 5 }}>
            <input autoFocus placeholder="Raw value…" value={rawVal} onChange={e => setRawVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onSelect(null, rawVal); setRawMode(false); } }}
              style={{ flex: 1, background: SB.bg, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: SB.mono }} />
            <button onClick={() => { onSelect(null, rawVal); setRawMode(false); }}
              style={{ background: SB.accent, border: 'none', color: '#fff', borderRadius: SB.radiusSm, padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontFamily: SB.font }}>Apply</button>
          </div>
        ) : (
          <button onClick={() => setRawMode(true)}
            style={{ background: 'none', border: `1px solid ${SB.border}`, color: SB.textMuted, borderRadius: SB.radiusSm, padding: '3px 10px', cursor: 'pointer', fontSize: 11, width: '100%', fontFamily: SB.font }}>
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
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: SB.radiusSm, cursor: 'pointer', background: SB.bgSecondary, border: `1px solid ${SB.border}`, flex, minWidth: 0, userSelect: 'none', transition: 'border-color 0.1s' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = SB.accent}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = SB.border}
      >
        {filter === 'color' && <div style={{ ...tokenSwatch(resolved || 'transparent') }} />}
        <span style={{ flex: 1, color: SB.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{display}</span>
        <span style={{ color: SB.textMuted, fontSize: 9, flexShrink: 0 }}>▾</span>
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
  channel:     ReturnType<typeof addons.getChannel>;
}

function LayerRow({ node, depth, selectedId, layerNames, onSelect, onRename, channel }: LayerRowProps) {
  const [open,    setOpen]    = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const wrapInDiv = (e: React.MouseEvent) => {
    e.stopPropagation();
    channel.emit('DESIGN/WRAP_IN_DIV', { path: node.path });
  };
  const insertSibling = (e: React.MouseEvent) => {
    e.stopPropagation();
    channel.emit('DESIGN/INSERT_SIBLING', { path: node.path });
  };

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
          background: isSelected ? SB.accentGlow : 'transparent',
          borderLeft: isSelected ? `2px solid ${SB.accent}` : '2px solid transparent',
          userSelect: 'none', transition: 'background 0.08s',
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = SB.bgHover; }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Expand / collapse triangle */}
        <span
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          style={{
            width: 14, flexShrink: 0, color: SB.textMuted, fontSize: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s',
          }}
        >▶</span>

        {/* Layer icon */}
        <span style={{ marginRight: 5, fontSize: 10, color: isSelected ? SB.accent : SB.textMuted, flexShrink: 0 }}>
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
            style={{ flex: 1, background: SB.bg, border: `1px solid ${SB.accent}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 11, padding: '1px 4px', outline: 'none', fontFamily: SB.font, minWidth: 0 }}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: isSelected ? SB.text : SB.textMuted }}
            title="Double-click to rename">
            {displayName}
            {layerNames[node.id] && <span style={{ color: SB.accent, fontSize: 9, marginLeft: 3 }}>✎</span>}
          </span>
        )}

        {/* Size hint + layer actions */}
        {isSelected && !editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 4 }}>
            {node.w > 0 && <span style={{ fontSize: 9, color: SB.textMuted }}>{node.w}×{node.h}</span>}
            <button onClick={wrapInDiv} title="Wrap in div"
              style={{ background: 'none', border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.textMuted, fontSize: 9, padding: '1px 4px', cursor: 'pointer', lineHeight: 1.2, fontFamily: SB.mono }}>
              [ ]
            </button>
            <button onClick={insertSibling} title="Insert inline sibling"
              style={{ background: 'none', border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.textMuted, fontSize: 9, padding: '1px 4px', cursor: 'pointer', lineHeight: 1.2, fontFamily: SB.mono }}>
              +
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {open && hasChildren && node.children.map(child => (
        <LayerRow key={child.id} node={child} depth={depth + 1}
          selectedId={selectedId} layerNames={layerNames}
          onSelect={onSelect} onRename={onRename} channel={channel} />
      ))}
    </>
  );
}

// ─── Section wrapper — Figma inspector style ─────────────────────────────────
// Flat uppercase label, no chevron, always visible, subtle separator

function Section({ label, children, defaultOpen = true, noPad = false, forceOpen }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean; noPad?: boolean; forceOpen?: boolean | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen != null ? forceOpen : open;
  return (
    <div style={{ borderBottom: `1px solid ${SB.border}` }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'none', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: 28, cursor: 'pointer', fontFamily: SB.font,
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: SB.textMuted }}>{label}</span>
        <span style={{ fontSize: 9, color: SB.textMuted, opacity: 0.5, lineHeight: 1, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
      </button>
      {isOpen && <div style={noPad ? {} : { padding: '0 14px 10px' }}>{children}</div>}
    </div>
  );
}

// Standard label-left / value-right row (Figma inspector row)
function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: SB.rowH, gap: 6 }}>
      {label && <span style={{ width: 72, flexShrink: 0, fontSize: 11, color: SB.textMuted, fontFamily: SB.font, letterSpacing: '0.01em' }}>{label}</span>}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  );
}

// 2-column grid for paired inputs (X/Y, W/H, Gap/Radius — like Figma's layout section)
function PropGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 4px', paddingBottom: 4 }}>
      {children}
    </div>
  );
}

// A labeled mini-field for use inside PropGrid — label above, input below
function PropCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, color: SB.textMuted, fontFamily: SB.font, letterSpacing: '0.05em', textTransform: 'uppercase', paddingLeft: 4 }}>{label}</span>
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
  const fromProp = parsePx(value) === 0 && !value ? '' : parsePx(value).toString();
  const [local, setLocal]         = useState('');
  const [active, setActive]       = useState(false);
  const [committed, setCommitted] = useState(fromProp);

  // Sync committed display when prop changes externally (e.g. undo, reset)
  useEffect(() => {
    if (!active) setCommitted(fromProp);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const next = n + (suffix || 'px');
      setCommitted(n.toString());
      onChange(next);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', background: active ? SB.bgSecondary : 'transparent', border: `1px solid ${active ? SB.borderFocus : 'transparent'}`, borderRadius: SB.radiusSm, overflow: 'hidden', flex: 1, transition: 'border-color 0.1s, background 0.1s', ...extraStyle }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = SB.bgSecondary; (e.currentTarget as HTMLElement).style.borderColor = SB.border; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; } }}>
      <input
        value={active ? local : committed}
        placeholder={placeholder}
        onFocus={e => { setLocal(committed); setActive(true); (e.target.parentElement as HTMLElement).style.borderColor = SB.borderFocus; (e.target.parentElement as HTMLElement).style.background = SB.bgSecondary; }}
        onBlur={e => {
          setActive(false);
          (e.target.parentElement as HTMLElement).style.borderColor = 'transparent';
          (e.target.parentElement as HTMLElement).style.background = 'transparent';
          commit(local);
        }}
        onChange={e => setLocal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(local); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setActive(false); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); const n = parsePx(value) + step; if (max === undefined || n <= max) { setCommitted(n.toString()); onChange(n + (suffix || 'px')); } }
          if (e.key === 'ArrowDown') { e.preventDefault(); const n = parsePx(value) - step; if (min === undefined || n >= min) { setCommitted(n.toString()); onChange(n + (suffix || 'px')); } }
        }}
        style={{ flex: 1, background: 'transparent', border: 'none', color: SB.text, fontSize: 12, padding: '3px 6px', outline: 'none', fontFamily: SB.mono, minWidth: 0, width: '100%', textAlign: 'right' }}
      />
      {suffix && <span style={{ color: SB.textMuted, fontSize: 10, paddingRight: 5, flexShrink: 0 }}>{suffix}</span>}
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
      style={{ background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, padding: '3px 6px', outline: 'none', cursor: 'pointer', flex: 1, fontFamily: SB.font, ...extraStyle }}>
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
    <div title={title} style={{ display: 'flex', background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radius, overflow: 'hidden', flexShrink: 0 }}>
      {options.map(o => (
        <button key={o.value} title={o.title ?? o.label} onClick={() => onChange(o.value)}
          style={{
            padding: '3px 7px', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: SB.font,
            background: value === o.value ? SB.accent : 'transparent',
            color: value === o.value ? SB.accentText : SB.textMuted,
            borderRight: `1px solid ${SB.border}`,
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
        padding: '2px 6px', border: `1px solid ${active ? SB.accent : SB.border}`,
        borderRadius: SB.radiusSm, cursor: 'pointer', fontSize: 11, fontFamily: SB.font,
        background: active ? SB.accentGlow : 'transparent',
        color: active ? SB.accent : SB.textMuted,
        flexShrink: 0, transition: 'all 0.1s',
      }}>
      {children}
    </button>
  );
}

// ─── OpacitySlider ────────────────────────────────────────────────────────────

function OpacitySlider({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pct = Math.round(parseFloat(value || '1') * 100);
  const [localPct, setLocalPct] = useState(String(pct));
  const [focused,  setFocused]  = useState(false);
  useEffect(() => { if (!focused) setLocalPct(String(pct)); }, [pct, focused]);

  const commitPct = () => {
    setFocused(false);
    const n = Math.max(0, Math.min(100, parseInt(localPct) || 0));
    setLocalPct(String(n));
    onChange((n / 100).toString());
  };

  return (
    <Row label="Opacity">
      <input type="range" min={0} max={100} value={pct}
        onChange={e => { const n = parseInt(e.target.value); setLocalPct(String(n)); onChange((n / 100).toString()); }}
        style={{ flex: 1, accentColor: SB.accent, cursor: 'pointer' }} />
      <input
        value={localPct}
        onChange={e => setLocalPct(e.target.value)}
        onFocus={e => { setFocused(true); e.target.select(); }}
        onBlur={commitPct}
        onKeyDown={e => { if (e.key === 'Enter') commitPct(); }}
        style={{
          width: 38, textAlign: 'right', fontSize: 12, fontFamily: SB.mono,
          background: focused ? SB.bgSecondary : 'transparent',
          border: focused ? `1px solid ${SB.accent}` : '1px solid transparent',
          borderRadius: SB.radius, color: SB.text, outline: 'none', padding: '1px 3px',
        }}
      />
      <span style={{ fontSize: 12, color: SB.textMuted, width: 10 }}>%</span>
    </Row>
  );
}

// ─── SkinInput ────────────────────────────────────────────────────────────────
// The "skin" of a component is a single class name that references all its
// visual properties as a collective (like a Tailwind component class or a CVA
// base). This component lets you set that one class and shows a read-only
// preview of the computed styles it resolves to. Utility overrides (the long
// Tailwind soup) are shown as small removable pills below — you don't need to
// type them, they're already there from the component source.

// Heuristic: a "skin" class is short, has no colon (no responsive/state prefix),
// and is not a pure Tailwind utility (no hyphen between known prefix + value).
// Everything else is a utility modifier shown as read-only pills.
const TAILWIND_PREFIXES_RE = /^(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|overflow|z-|w-|h-|min-|max-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|gap-|space-|text-|font-|leading-|tracking-|bg-|border-|rounded-|shadow-|ring-|opacity-|transition-|duration-|ease-|delay-|scale-|rotate-|translate-|skew-|origin-|cursor-|select-|appearance-|outline-|sr-|not-sr-|list-|object-|place-|content-|items-|justify-|self-|col-|row-|order-|grow|shrink|basis-|aspect-|columns-|float-|clear-|box-|table-|caption-|border-collapse|border-separate|align-|whitespace-|break-|truncate|line-clamp|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|italic|not-italic|antialiased|subpixel-antialiased|divide-|accent-|caret-|fill-|stroke-|decoration-|indent-|vertical-|hyphens-|resize|pointer-|touch-|user-|will-change-|forced-color|print:|dark:|rtl:|ltr:|open:|motion-|snap-|scroll-)/;

function isTailwindUtil(cls: string): boolean {
  if (cls.includes(':')) return true; // state/responsive modifier
  return TAILWIND_PREFIXES_RE.test(cls);
}

function SkinInput({ classList, styles, onAddClass, onRemoveClass }: {
  classList: string;
  styles: ElementStyles | null;
  onAddClass: (cls: string) => void;
  onRemoveClass: (cls: string) => void;
}) {
  const classes   = classList.split(/\s+/).filter(Boolean);
  const skinClass = classes.find(c => !isTailwindUtil(c)) ?? '';
  const utils     = classes.filter(c => isTailwindUtil(c));

  const [draft,   setDraft]   = useState(skinClass);
  const [focused, setFocused] = useState(false);

  useEffect(() => { if (!focused) setDraft(skinClass); }, [skinClass, focused]);

  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (next === skinClass) return;
    if (skinClass) onRemoveClass(skinClass);
    if (next)      onAddClass(next);
  };

  // Resolved style preview — key properties that a skin class typically controls
  const preview: { label: string; value: string }[] = [];
  if (styles) {
    if (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)') preview.push({ label: 'bg',      value: styles.backgroundColor });
    if (styles.color)             preview.push({ label: 'color',   value: styles.color });
    if (styles.borderRadius && styles.borderRadius !== '0px') preview.push({ label: 'radius',  value: styles.borderRadius });
    if (styles.fontSize)          preview.push({ label: 'size',    value: styles.fontSize });
    if (styles.fontWeight && styles.fontWeight !== '400') preview.push({ label: 'weight',  value: styles.fontWeight });
    if (styles.paddingTop && styles.paddingTop !== '0px') preview.push({ label: 'padding',  value: styles.paddingTop });
  }

  return (
    <div style={{ padding: '8px 12px 10px' }}>
      {/* Skin class field */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Skin</div>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setDraft(skinClass); setFocused(false); }
          }}
          spellCheck={false}
          placeholder="e.g. badge, btn-primary…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: focused ? SB.bgSecondary : SB.bgHover,
            border: `1px solid ${focused ? SB.accent : SB.border}`,
            borderRadius: SB.radius, color: SB.text, fontSize: 12,
            padding: '5px 8px', outline: 'none', fontFamily: SB.mono,
            transition: 'border-color 0.1s',
          }}
        />
      </div>

      {/* Resolved style preview */}
      {preview.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 8 }}>
          {preview.map(p => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: SB.textMuted }}>
              <span>{p.label}</span>
              {p.label === 'bg' || p.label === 'color' ? (
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                  background: p.value, border: `1px solid ${SB.border}`, flexShrink: 0,
                }} />
              ) : (
                <span style={{ color: SB.text, fontFamily: SB.mono }}>{p.value}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Utility modifier pills — collapsible, read-only, removable */}
      {utils.length > 0 && <ModifierPills utils={utils} onRemove={onRemoveClass} />}
    </div>
  );
}

function ModifierPills({ utils, onRemove }: { utils: string[]; onRemove: (cls: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: open ? 4 : 0,
      }}>
        <span style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Modifiers</span>
        <span style={{ fontSize: 9, color: SB.textMuted, opacity: 0.6 }}>{open ? '▾' : '▸'} {utils.length}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {utils.map(cls => (
            <span key={cls} style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              background: SB.bgSecondary, borderRadius: SB.radius, padding: '1px 5px',
              fontSize: 9, color: SB.textMuted, fontFamily: SB.mono,
            }}>
              {cls}
              <button onClick={() => onRemove(cls)}
                style={{ background: 'none', border: 'none', color: SB.textMuted, cursor: 'pointer', padding: '0 0 0 2px', fontSize: 9, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TextStylePicker ───────────────────────────────────────────────────────
// Reads text style presets from design-system CSS custom properties.
// Looks for --text-* or --font-* variables and shows them as selectable rows.

const TEXT_STYLE_CLASSES = [
  { label: 'Display',       cls: 'text-display',    size: '3rem',   weight: '700' },
  { label: 'Heading 1',     cls: 'text-h1',         size: '2rem',   weight: '700' },
  { label: 'Heading 2',     cls: 'text-h2',         size: '1.5rem', weight: '600' },
  { label: 'Heading 3',     cls: 'text-h3',         size: '1.25rem',weight: '600' },
  { label: 'Subtitle',      cls: 'text-subtitle',   size: '1.125rem',weight: '500' },
  { label: 'Body',          cls: 'text-body',       size: '1rem',   weight: '400' },
  { label: 'Body Small',    cls: 'text-body-sm',    size: '0.875rem',weight: '400' },
  { label: 'Caption',       cls: 'text-caption',    size: '0.75rem',weight: '400' },
  { label: 'Overline',      cls: 'text-overline',   size: '0.6875rem',weight: '600' },
  { label: 'Code',          cls: 'font-mono',       size: '0.875rem',weight: '400' },
];

function TextStylePicker({ classList, tokens, onAddClass, onRemoveClass, onChangeInline }: {
  classList: string;
  tokens: TokenEntry[];
  onAddClass: (cls: string) => void;
  onRemoveClass: (cls: string) => void;
  onChangeInline: (prop: string, value: string) => void;
}) {
  const active = TEXT_STYLE_CLASSES.find(s => classList.split(/\s+/).includes(s.cls));
  const [hovered, setHovered] = useState<typeof TEXT_STYLE_CLASSES[0] | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const apply = (style: typeof TEXT_STYLE_CLASSES[0]) => {
    TEXT_STYLE_CLASSES.forEach(s => {
      if (classList.split(/\s+/).includes(s.cls)) onRemoveClass(s.cls);
    });
    onAddClass(style.cls);
    onChangeInline('font-size', style.size);
    onChangeInline('font-weight', style.weight);
  };

  return (
    <div style={{ padding: '0 14px 10px', position: 'relative' }}>
      <Row label="Style">
        <div style={{ flex: 1, position: 'relative' }}>
          <select
            value={active?.cls ?? ''}
            onChange={e => {
              const s = TEXT_STYLE_CLASSES.find(s => s.cls === e.target.value);
              if (s) apply(s);
            }}
            style={{
              width: '100%', background: SB.bgSecondary, border: `1px solid ${SB.border}`,
              borderRadius: SB.radiusSm, color: active ? SB.text : SB.textMuted,
              fontSize: 12, padding: '3px 24px 3px 8px', outline: 'none',
              fontFamily: SB.font, cursor: 'pointer', appearance: 'none',
            }}
          >
            <option value="" disabled style={{ background: SB.bg }}>— pick a style —</option>
            {TEXT_STYLE_CLASSES.map(s => (
              <option key={s.cls} value={s.cls} style={{ background: SB.bg, color: SB.text }}>
                {s.label}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: SB.textMuted, fontSize: 9 }}>▾</span>
        </div>
      </Row>

      {/* Hover preview — show when select is focused via a floating panel */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', marginTop: 4 }}>
        {TEXT_STYLE_CLASSES.map(s => {
          const isActive = s.cls === active?.cls;
          return (
            <span
              key={s.cls}
              onClick={() => apply(s)}
              onMouseEnter={e => { setHovered(s); setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect()); }}
              onMouseLeave={() => { setHovered(null); setAnchorRect(null); }}
              style={{
                fontSize: 9, fontFamily: SB.mono, padding: '1px 5px',
                borderRadius: SB.radiusSm, cursor: 'pointer',
                background: isActive ? SB.accentGlow : SB.bgSecondary,
                color: isActive ? SB.accent : SB.textMuted,
                border: `1px solid ${isActive ? SB.accent : 'transparent'}`,
                userSelect: 'none',
              }}
            >
              {s.label}
            </span>
          );
        })}
      </div>

      {/* Floating preview tooltip */}
      {hovered && anchorRect && (
        <div style={{
          position: 'fixed',
          left: anchorRect.left - 220,
          top: anchorRect.top - 20,
          zIndex: 9999,
          background: SB.bgSecondary,
          border: `1px solid ${SB.border}`,
          borderRadius: SB.radius,
          padding: '12px 16px',
          width: 210,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: SB.mono }}>
            {hovered.label} · {hovered.size} / {hovered.weight}
          </div>
          <div style={{ fontFamily: SB.font, fontSize: hovered.size, fontWeight: hovered.weight, color: SB.text, lineHeight: 1.3 }}>
            The quick brown fox
          </div>
          <div style={{ fontFamily: SB.font, fontSize: hovered.size, fontWeight: hovered.weight, color: SB.textMuted, lineHeight: 1.3, marginTop: 4 }}>
            Aa Bb Cc 123
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ComponentVariants ────────────────────────────────────────────────────────
// Interaction states are fixed pseudostate toggles — they force CSS pseudo-
// classes on the element via JS class injection (e.g. adding a `.\\:hover`
// class that Tailwind generates). UI-mode variants come from CVA parsing and
// are rendered as one pill group per key.

// Interaction states we always show, regardless of CVA variants
const INTERACTION_STATES = [
  { label: 'Hover',    pseudo: 'hover' },
  { label: 'Focus',    pseudo: 'focus' },
  { label: 'Active',   pseudo: 'active' },
  { label: 'Disabled', pseudo: 'disabled' },
] as const;

// CVA variant keys that are "interaction-like" and should be hidden
// (they duplicate the interaction toggles above)
const INTERACTION_KEYS = new Set(['hover', 'focus', 'active', 'disabled', 'focusVisible', 'focus-visible', 'dark', 'state']);

function ComponentVariants({ storyId, selectedPath, channel, onApplyVariant }: {
  storyId: string;
  selectedPath: number[];
  channel: ReturnType<typeof addons.getChannel>;
  onApplyVariant: (varName: string, val: string) => void;
}) {
  const [variants,    setVariants]    = useState<Record<string, string[]>>({});
  const [activeMode,  setActiveMode]  = useState<Record<string, string>>({});
  const [activeStates, setActiveStates] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!storyId) return;
    fetch(`${API_BASE}/api/component-variants?storyId=${encodeURIComponent(storyId)}`)
      .then(r => r.json())
      .then((d: { variants?: Record<string, string[]> }) => { if (d.variants) setVariants(d.variants); })
      .catch(() => {});
  }, [storyId]);

  // Values that are interaction-state names and should be stripped from variant lists
  const INTERACTION_VALUES = new Set(['hover', 'focus', 'active', 'disabled', 'focus-visible', 'focusvisible', 'dark', 'light']);

  // UI-mode keys only — filter out interaction-like keys, deduplicate values,
  // strip interaction-like values, require ≥2 remaining unique values
  const modeKeys = Object.keys(variants).filter(k => {
    if (INTERACTION_KEYS.has(k.toLowerCase())) return false;
    const unique = [...new Set(
      variants[k].filter(v => !INTERACTION_VALUES.has(v.toLowerCase()))
    )];
    return unique.length > 1;
  });

  const applyMode = (varName: string, val: string) => {
    onApplyVariant(varName, val);
    setActiveMode(a => ({ ...a, [varName]: val }));
  };

  const toggleState = (pseudo: string) => {
    const next = new Set(activeStates);
    if (next.has(pseudo)) {
      next.delete(pseudo);
      channel.emit('DESIGN/REMOVE_CLASS', { path: selectedPath, cls: `pseudo-${pseudo}` });
    } else {
      next.add(pseudo);
      // Add a utility class that forces the pseudo-state appearance.
      // Tailwind JIT generates e.g. `hover:bg-primary` — we can't truly force :hover,
      // but we can add a data attribute that some components respond to, or simply
      // add the class token so the user sees the label as "on".
      channel.emit('DESIGN/ADD_CLASS', { path: selectedPath, cls: `pseudo-${pseudo}` });
    }
    setActiveStates(next);
  };

  return (
    <div>
      {/* ── Interaction States ── */}
      <div style={{ marginBottom: modeKeys.length > 0 ? 10 : 0 }}>
        <div style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>State</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {INTERACTION_STATES.map(({ label, pseudo }) => {
            const on = activeStates.has(pseudo);
            return (
              <button key={pseudo} onClick={() => toggleState(pseudo)}
                style={{
                  padding: '3px 9px', borderRadius: SB.radius, cursor: 'pointer',
                  fontSize: 11, fontFamily: SB.font, fontWeight: on ? 700 : 400,
                  border: `1px solid ${on ? SB.accent : SB.border}`,
                  background: on ? `${SB.accent}25` : 'transparent',
                  color: on ? SB.accent : SB.textMuted,
                  transition: 'all 0.1s',
                }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── UI Mode Variants (one group per CVA key) ── */}
      {modeKeys.map(varName => {
        const vals = [...new Set(variants[varName].filter(v => !INTERACTION_VALUES.has(v.toLowerCase())))];
        return (
        <div key={varName} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{varName}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {vals.map(val => (
              <button key={val} onClick={() => applyMode(varName, val)}
                style={{
                  padding: '3px 9px', borderRadius: SB.radius, cursor: 'pointer',
                  fontSize: 11, fontFamily: SB.font,
                  border: `1px solid ${activeMode[varName] === val ? SB.accent : SB.border}`,
                  background: activeMode[varName] === val ? `${SB.accent}25` : 'transparent',
                  color: activeMode[varName] === val ? SB.accent : SB.textMuted,
                  transition: 'all 0.1s',
                }}>
                {val}
              </button>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}


// ─── SpacingBox ───────────────────────────────────────────────────────────────
// Figma-style: collapsed = 2 fields (H, V) with a split icon to expand to 4 sides.

function parsePxNum(v: string) { return Math.round(parseFloat(v)) || 0; }

// Single inline-editable number field with icon prefix
function SpacingField({ icon, prop, val, onChangeInline, flex = 1 }: {
  icon: React.ReactNode; prop: string; val: string;
  onChangeInline: (prop: string, value: string) => void;
  flex?: number;
}) {
  const [local, setLocal] = useState(String(parsePxNum(val)));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(String(parsePxNum(val))); }, [val, focused]);

  const commit = () => { setFocused(false); onChangeInline(prop, local + 'px'); };
  const nudge = (delta: number) => {
    const n = Math.max(0, (parseInt(local) || 0) + delta);
    setLocal(String(n)); onChangeInline(prop, n + 'px');
  };

  return (
    <div style={{
      flex, display: 'flex', alignItems: 'center', gap: 5,
      background: SB.bgSecondary, border: `1px solid ${focused ? SB.accent : SB.border}`,
      borderRadius: SB.radius, padding: '4px 8px', minWidth: 0,
    }}>
      <span style={{ color: SB.textMuted, fontSize: 11, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
      <input
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={e => { setFocused(true); e.target.select(); }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp')   { e.preventDefault(); nudge(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
        }}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: SB.text, fontSize: 12, fontFamily: SB.mono, minWidth: 0,
        }}
      />
    </div>
  );
}

// The 4-side expand toggle icon (like Figma's split corners)
function SplitIcon({ split }: { split: boolean }) {
  const c = split ? SB.accent : SB.textMuted;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke={c} strokeWidth="1.2"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke={c} strokeWidth="1.2"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke={c} strokeWidth="1.2"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke={c} strokeWidth="1.2"/>
    </svg>
  );
}

function SpacingGroup({ label, top, right, bottom, left, propTop, propRight, propBottom, propLeft, onChangeInline }: {
  label: string;
  top: string; right: string; bottom: string; left: string;
  propTop: string; propRight: string; propBottom: string; propLeft: string;
  onChangeInline: (prop: string, value: string) => void;
}) {
  const [split, setSplit] = useState(false);

  // H = left+right averaged; V = top+bottom averaged (for collapsed display)
  const avgH = Math.round((parsePxNum(left) + parsePxNum(right)) / 2);
  const avgV = Math.round((parsePxNum(top)  + parsePxNum(bottom)) / 2);

  const setH = (v: string) => { onChangeInline(propLeft, v); onChangeInline(propRight, v); };
  const setV = (v: string) => { onChangeInline(propTop,  v); onChangeInline(propBottom, v); };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: SB.textMuted, fontFamily: SB.font }}>{label}</span>
        <button onClick={() => setSplit(s => !s)} title={split ? 'Collapse sides' : 'Split sides'}
          style={{
            background: split ? `${SB.accent}20` : 'transparent',
            border: `1px solid ${split ? SB.accent : SB.border}`,
            borderRadius: SB.radius, cursor: 'pointer', padding: '2px 4px',
            display: 'flex', alignItems: 'center',
          }}>
          <SplitIcon split={split} />
        </button>
      </div>

      {split ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {/* Left icon = ←|→ (horizontal pair) */}
            <SpacingField icon="←" prop={propLeft}   val={left}   onChangeInline={onChangeInline} />
            <SpacingField icon="→" prop={propRight}  val={right}  onChangeInline={onChangeInline} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SpacingField icon="↑" prop={propTop}    val={top}    onChangeInline={onChangeInline} />
            <SpacingField icon="↓" prop={propBottom} val={bottom} onChangeInline={onChangeInline} />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          {/* H field sets left+right, V sets top+bottom */}
          <SpacingField icon="⇔" prop={propLeft} val={String(avgH)} onChangeInline={setH} />
          <SpacingField icon="⇕" prop={propTop}  val={String(avgV)} onChangeInline={setV} />
        </div>
      )}
    </div>
  );
}

function SpacingBox({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  return (
    <div>
      <SpacingGroup
        label="Padding"
        top={styles.paddingTop} right={styles.paddingRight} bottom={styles.paddingBottom} left={styles.paddingLeft}
        propTop="padding-top" propRight="padding-right" propBottom="padding-bottom" propLeft="padding-left"
        onChangeInline={onChangeInline}
      />
      <SpacingGroup
        label="Margin"
        top={styles.marginTop} right={styles.marginRight} bottom={styles.marginBottom} left={styles.marginLeft}
        propTop="margin-top" propRight="margin-right" propBottom="margin-bottom" propLeft="margin-left"
        onChangeInline={onChangeInline}
      />
    </div>
  );
}

// ─── LayoutControls ───────────────────────────────────────────────────────────

const DISPLAY_OPTS = [
  { label: 'Block',  value: 'block' }, { label: 'Flex', value: 'flex' },
  { label: 'Grid',   value: 'grid' },  { label: 'Inline', value: 'inline' },
  { label: 'Inline-flex', value: 'inline-flex' }, { label: 'None', value: 'none' },
];
const FLEX_DIR_OPTS = [
  { label: '→', value: 'row', title: 'Row' }, { label: '↓', value: 'column', title: 'Column' },
  { label: '←', value: 'row-reverse', title: 'Row reverse' }, { label: '↑', value: 'column-reverse', title: 'Column reverse' },
];
const JUSTIFY_OPTS = [
  { label: '⇤', value: 'flex-start', title: 'Start' }, { label: '⇥', value: 'flex-end', title: 'End' },
  { label: '⇔', value: 'center', title: 'Center' }, { label: '⇹', value: 'space-between', title: 'Space between' },
  { label: '⇸', value: 'space-around', title: 'Space around' },
];
const ALIGN_OPTS = [
  { label: '⤒', value: 'flex-start', title: 'Start' }, { label: '⤓', value: 'flex-end', title: 'End' },
  { label: '↕', value: 'center', title: 'Center' }, { label: '⇕', value: 'stretch', title: 'Stretch' },
];
const WRAP_OPTS = [
  { label: 'No wrap', value: 'nowrap' }, { label: 'Wrap', value: 'wrap' }, { label: 'Wrap-rev', value: 'wrap-reverse' },
];

function LayoutControls({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  const isFlex = styles.display === 'flex' || styles.display === 'inline-flex';
  const isGrid = styles.display === 'grid';
  return (
    <div>
      <Row label="Display">
        <SelectInput value={styles.display} options={DISPLAY_OPTS} onChange={v => onChangeInline('display', v)} />
      </Row>
      {isFlex && (<>
        <Row label="Direction">
          <div style={{ display: 'flex', gap: 3 }}>
            {FLEX_DIR_OPTS.map(o => <IconBtn key={o.value} active={styles.flexDirection === o.value} onClick={() => onChangeInline('flex-direction', o.value)} title={o.title}>{o.label}</IconBtn>)}
          </div>
        </Row>
        <Row label="Justify">
          <div style={{ display: 'flex', gap: 3 }}>
            {JUSTIFY_OPTS.map(o => <IconBtn key={o.value} active={styles.justifyContent === o.value} onClick={() => onChangeInline('justify-content', o.value)} title={o.title}>{o.label}</IconBtn>)}
          </div>
        </Row>
        <Row label="Align">
          <div style={{ display: 'flex', gap: 3 }}>
            {ALIGN_OPTS.map(o => <IconBtn key={o.value} active={styles.alignItems === o.value} onClick={() => onChangeInline('align-items', o.value)} title={o.title}>{o.label}</IconBtn>)}
          </div>
        </Row>
        <PropGrid>
          <PropCell label="Wrap">
            <SelectInput value={styles.flexWrap} options={WRAP_OPTS} onChange={v => onChangeInline('flex-wrap', v)} />
          </PropCell>
          <PropCell label="Gap">
            <NumberInput value={styles.gap} onChange={v => onChangeInline('gap', v)} min={0} />
          </PropCell>
        </PropGrid>
      </>)}
      {isGrid && (
        <PropGrid>
          <PropCell label="Gap">
            <NumberInput value={styles.gap} onChange={v => onChangeInline('gap', v)} min={0} />
          </PropCell>
        </PropGrid>
      )}
    </div>
  );
}

// ─── SizeControls ─────────────────────────────────────────────────────────────

type SizeMode = 'hug' | 'fill' | 'fixed';

function classifySize(val: string): SizeMode {
  if (!val || val === 'auto' || val === 'fit-content') return 'hug';
  if (val === '100%') return 'fill';
  return 'fixed';
}

function SizeModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', borderRadius: SB.radius, cursor: 'pointer',
      fontSize: 11, fontFamily: SB.font, fontWeight: active ? 700 : 400,
      border: `1px solid ${active ? SB.accent : SB.border}`,
      background: active ? `${SB.accent}18` : 'transparent',
      color: active ? SB.accent : SB.textMuted,
      transition: 'all 0.1s',
    }}>{label}</button>
  );
}

function SizeDimension({ label, prop, value, onChangeInline }: {
  label: string; prop: string; value: string;
  onChangeInline: (prop: string, value: string) => void;
}) {
  // Local mode tracks the last-clicked intent so UI stays in sync before preview responds
  const [localMode, setLocalMode] = useState<SizeMode | null>(null);
  useEffect(() => { setLocalMode(null); }, [value]);
  const mode = localMode ?? classifySize(value);

  const setMode = (m: SizeMode) => {
    setLocalMode(m);
    if (m === 'hug')   onChangeInline(prop, 'fit-content');
    if (m === 'fill')  onChangeInline(prop, '100%');
    if (m === 'fixed') onChangeInline(prop, classifySize(value) === 'fixed' && value ? value : '100px');
  };
  return (
    <Row label={label}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', flex: 1 }}>
        <SizeModeBtn label="Hug"   active={mode === 'hug'}   onClick={() => setMode('hug')} />
        <SizeModeBtn label="Fill"  active={mode === 'fill'}  onClick={() => setMode('fill')} />
        <SizeModeBtn label="Fixed" active={mode === 'fixed'} onClick={() => setMode('fixed')} />
        {mode === 'fixed' && <NumberInput value={value} onChange={v => onChangeInline(prop, v)} placeholder="px" />}
      </div>
    </Row>
  );
}

function SizeControls({ styles, onChangeInline }: {
  styles: ElementStyles | null;
  onChangeInline: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  return (
    <div>
      <SizeDimension label="Width"  prop="width"  value={styles.width}  onChangeInline={onChangeInline} />
      <SizeDimension label="Height" prop="height" value={styles.height} onChangeInline={onChangeInline} />
      <PropGrid>
        <PropCell label="Min W">
          <NumberInput value={styles.minWidth}  onChange={v => onChangeInline('min-width', v)}  placeholder="—" />
        </PropCell>
        <PropCell label="Min H">
          <NumberInput value={styles.minHeight} onChange={v => onChangeInline('min-height', v)} placeholder="—" />
        </PropCell>
        <PropCell label="Max W">
          <NumberInput value={styles.maxWidth}  onChange={v => onChangeInline('max-width', v)}  placeholder="—" />
        </PropCell>
        <PropCell label="Max H">
          <NumberInput value={styles.maxHeight} onChange={v => onChangeInline('max-height', v)} placeholder="—" />
        </PropCell>
      </PropGrid>
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
  { label: '≡', value: 'left', title: 'Left' }, { label: '≡', value: 'center', title: 'Center' },
  { label: '≡', value: 'right', title: 'Right' }, { label: '≡', value: 'justify', title: 'Justify' },
];
const TEXT_TRANSFORM_OPTS = [
  { label: 'Aa', value: 'none', title: 'None' }, { label: 'AA', value: 'uppercase', title: 'Uppercase' },
  { label: 'aa', value: 'lowercase', title: 'Lowercase' }, { label: 'Aa', value: 'capitalize', title: 'Capitalize' },
];

function TypographyControls({ styles, tokens, textVal, textProp, onChangeInline, onChangeToken, onSave }: {
  styles: ElementStyles | null; tokens: TokenEntry[];
  textVal: string; textProp: string;
  onChangeInline: (prop: string, value: string) => void;
  onChangeToken: (prop: string, value: string) => void;
  onSave: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  const isBold   = styles.textDecoration?.includes('underline');
  const isStrike = styles.textDecoration?.includes('line-through');
  return (
    <div>
      <Row label="Color">
        <TokenField value={textVal} tokens={tokens} filter="color" onChange={v => onChangeToken(textProp, v)} />
        <button onClick={() => onSave(textProp, textVal)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: SB.textMuted, fontSize: 12, padding: '2px 4px' }}>↗</button>
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
          {TEXT_ALIGN_OPTS.map(o => <IconBtn key={o.value} active={styles.textAlign === o.value} onClick={() => onChangeInline('text-align', o.value)} title={o.title}>{o.label}</IconBtn>)}
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          <IconBtn active={isBold}   onClick={() => onChangeInline('text-decoration', isBold   ? 'none' : 'underline')}    title="Underline">U̲</IconBtn>
          <IconBtn active={isStrike} onClick={() => onChangeInline('text-decoration', isStrike ? 'none' : 'line-through')} title="Strikethrough">S̶</IconBtn>
        </div>
      </Row>
      <Row label="Transform">
        <div style={{ display: 'flex', gap: 3 }}>
          {TEXT_TRANSFORM_OPTS.map(o => <IconBtn key={o.value} active={styles.textTransform === o.value} onClick={() => onChangeInline('text-transform', o.value)} title={o.title}>{o.label}</IconBtn>)}
        </div>
      </Row>
    </div>
  );
}

// ─── BorderControls ───────────────────────────────────────────────────────────

const BORDER_STYLE_OPTS = [
  { label: 'none', value: 'none' }, { label: 'solid', value: 'solid' },
  { label: 'dashed', value: 'dashed' }, { label: 'dotted', value: 'dotted' },
  { label: 'double', value: 'double' },
];

function BorderControls({ styles, tokens, strokeVal, strokeProp, onChangeInline, onChangeToken, onSave }: {
  styles: ElementStyles | null; tokens: TokenEntry[];
  strokeVal: string; strokeProp: string;
  onChangeInline: (prop: string, value: string) => void;
  onChangeToken: (prop: string, value: string) => void;
  onSave: (prop: string, value: string) => void;
}) {
  if (!styles) return null;
  return (
    <div>
      <Row label="Color">
        <TokenField value={strokeVal} tokens={tokens} filter="color" onChange={v => onChangeToken(strokeProp, v)} />
        <button onClick={() => onSave(strokeProp, strokeVal)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: SB.textMuted, fontSize: 12, padding: '2px 4px' }}>↗</button>
      </Row>
      <Row label="Width / Style">
        <NumberInput value={styles.borderWidth} onChange={v => onChangeInline('border-width', v)} min={0} />
        <SelectInput value={styles.borderStyle} options={BORDER_STYLE_OPTS} onChange={v => onChangeInline('border-style', v)} />
      </Row>
      <Row label="Radius">
        <NumberInput value={styles.borderTopLeftRadius}     onChange={v => onChangeInline('border-top-left-radius',     v)} placeholder="↖" />
        <NumberInput value={styles.borderTopRightRadius}    onChange={v => onChangeInline('border-top-right-radius',    v)} placeholder="↗" />
        <NumberInput value={styles.borderBottomRightRadius} onChange={v => onChangeInline('border-bottom-right-radius', v)} placeholder="↘" />
        <NumberInput value={styles.borderBottomLeftRadius}  onChange={v => onChangeInline('border-bottom-left-radius',  v)} placeholder="↙" />
      </Row>
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
  const [layerNames,      setLayerNames]      = useState<Record<string, string>>({});
  const [layerNamesDirty, setLayerNamesDirty] = useState(false);

  // ── Pending code changes ─────────────────────────────────────────────────────
  const [pendingText,   setPendingText]   = useState<{ path: number[]; prop: string; value: string } | null>(null);
  const [pendingInline, setPendingInline] = useState<Array<{ kind: 'style' | 'class' | 'variant'; label: string }>>([]);
  const [saving,        setSaving]        = useState(false);
  const [saveReport,    setSaveReport]    = useState<{ entries: { label: string; file: string; ok: boolean }[] } | null>(null);
  const [savedCount,    setSavedCount]    = useState(0);

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

  // ── Global section open/close ─────────────────────────────────────────────────
  const [globalOpenState, setGlobalOpenState] = useState<boolean | null>(null);

  // ── Canvas bg ─────────────────────────────────────────────────────────────────
  const [canvasMode,    setCanvasMode]    = useState<'light' | 'dark'>('dark');
  const [canvasBgLight, setCanvasBgLight] = useState('#ffffff');
  const [canvasBgDark,  setCanvasBgDark]  = useState('#0f0f10');
  const canvasBg = canvasMode === 'dark' ? canvasBgDark : canvasBgLight;
  useEffect(() => {
    channel.emit('DESIGN/SET_CANVAS_BG', { color: canvasBg });
  }, [canvasBg, channel]);

  // ── Custom global variants ────────────────────────────────────────────────────
  const [customVariants, setCustomVariants] = useState<Array<{ name: string; values: string[] }>>([]);
  const [cvOpen, setCvOpen] = useState(false);
  const [cvName, setCvName] = useState('');
  const [cvValues, setCvValues] = useState('');

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
  const colorNamesRef = useRef<string[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/tokens`)
      .then(r => r.json())
      .then((raw: TokenEntry[]) => {
        setTokens(raw);
        const colorNames = raw
          .filter(t => t.type === 'color')
          .map(t => t.name);
        colorNamesRef.current = colorNames;
        if (colorNames.length > 0) {
          // Retry until the preview iframe has connected and responded (max 5 times).
          let attempts = 0;
          let resolved = false;
          const stopRetry = () => { resolved = true; };
          channel.once('DESIGN/RESOLVED_TOKENS', stopRetry);
          const tryResolve = () => {
            if (resolved) return;
            attempts++;
            try { channel.emit('DESIGN/RESOLVE_TOKENS', colorNames); } catch { /* channel not ready */ }
            if (attempts < 5) setTimeout(tryResolve, 2000);
          };
          setTimeout(tryResolve, 1200);
        }
      })
      .catch(e => console.warn('[design-panel] token load failed:', e));
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
    setLayerNamesDirty(false);
    setPendingText(null);
    setPendingInline([]);
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
      try { channel.emit('DESIGN/RESET_ALL'); } catch { /* channel not ready */ }
    }

    const t = setTimeout(() => {
      try { channel.emit('DESIGN/BUILD_TREE'); } catch { /* channel not ready */ }
      try { channel.emit('DESIGN/INSPECT'); } catch { /* channel not ready */ }
      // Re-resolve token colors via browser after story CSS context is ready
      if (colorNamesRef.current.length > 0) {
        try { channel.emit('DESIGN/RESOLVE_TOKENS', colorNamesRef.current); } catch { /* not ready */ }
      }
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
    if (layerNamesDirty && Object.keys(layerNames).length > 0) {
      try {
        const r = await fetch(`${API_BASE}/api/layer-names`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId, layerNames }),
        });
        const d = await r.json() as { ok?: boolean; file?: string; error?: string };
        entries.push({ label: `Layer names (${Object.keys(layerNames).length})`, file: d.file ?? 'meta', ok: !!d.ok });
        if (d.ok) setLayerNamesDirty(false);
      } catch {
        entries.push({ label: 'Layer names', file: 'meta', ok: false });
      }
    }

    // 4. Inline style / class / variant changes → reported as acknowledged
    if (pendingInline.length > 0) {
      entries.push({
        label: `${pendingInline.length} inline edit${pendingInline.length > 1 ? 's' : ''} (live only — use CSS Variables to persist)`,
        file: 'live',
        ok: true,
      });
      setPendingInline([]);
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
  }, [saving, overrides, pendingText, pendingInline, layerNamesDirty, layerNames, storyId, channel]);

  // ── Layer rename ─────────────────────────────────────────────────────────────
  const renameLayer = useCallback((id: string, name: string) => {
    setLayerNames(prev => {
      const next = { ...prev };
      if (name) next[id] = name; else delete next[id];
      return next;
    });
    setLayerNamesDirty(true);
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
    setPendingInline([]);
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
    setPendingInline(prev => {
      const filtered = prev.filter(p => !(p.kind === 'style' && p.label.startsWith(prop + ':')));
      return [...filtered, { kind: 'style', label: `${prop}: ${value}` }];
    });
  }, [channel, selectedPath]);

  // ── Class add/remove (tracked for pending badge) ──────────────────────────
  const addClass = useCallback((cls: string) => {
    channel.emit('DESIGN/ADD_CLASS', { path: selectedPath, cls });
    setPendingInline(prev => [...prev, { kind: 'class', label: `+${cls}` }]);
  }, [channel, selectedPath]);

  const removeClass = useCallback((cls: string) => {
    channel.emit('DESIGN/REMOVE_CLASS', { path: selectedPath, cls });
    setPendingInline(prev => {
      // If we previously added this class, cancel them out
      const addIdx = prev.findLastIndex(p => p.kind === 'class' && p.label === `+${cls}`);
      if (addIdx !== -1) {
        const next = [...prev];
        next.splice(addIdx, 1);
        return next;
      }
      return [...prev, { kind: 'class', label: `-${cls}` }];
    });
  }, [channel, selectedPath]);

  // ── Variant change (tracked for pending badge) ────────────────────────────
  const applyVariant = useCallback((varName: string, val: string) => {
    channel.emit('DESIGN/SET_STORY_ARG', { prop: varName, value: val });
    setPendingInline(prev => {
      const filtered = prev.filter(p => !(p.kind === 'variant' && p.label.startsWith(varName + '=')));
      return [...filtered, { kind: 'variant', label: `${varName}=${val}` }];
    });
  }, [channel]);

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

  const s = {
    btn: {
      background: 'transparent',
      border: `1px solid ${SB.border}`,
      borderRadius: SB.radiusSm,
      color: SB.textMuted,
      fontSize: 11,
      fontFamily: SB.font,
      padding: '3px 8px',
      cursor: 'pointer',
      transition: 'all 0.1s',
    } as React.CSSProperties,
    iconBtn: {
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 13, padding: '2px 4px', lineHeight: 1, fontFamily: SB.font,
      color: SB.textMuted,
    } as React.CSSProperties,
  };

  const SaveBtn = ({ prop, value }: { prop: string; value: string }) => (
    <button onClick={() => saveToFile(prop, value)} title="Save to global.css"
      style={{ ...s.iconBtn, color: saved === prop ? SB.success : SB.textMuted }}>
      {saved === prop ? '✓' : '↗'}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SB.bg, color: SB.text, fontFamily: SB.font, fontSize: 12, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {(() => {
        const pendingCount = overrides.length + (pendingText ? 1 : 0) + pendingInline.length;
        const pendingParts = [
          overrides.length > 0 && `${overrides.length} CSS variable${overrides.length > 1 ? 's' : ''}`,
          pendingText && `text change`,
          pendingInline.filter(p => p.kind === 'style').length > 0 && `${pendingInline.filter(p => p.kind === 'style').length} inline style${pendingInline.filter(p => p.kind === 'style').length > 1 ? 's' : ''}`,
          pendingInline.filter(p => p.kind === 'class').length > 0 && `${pendingInline.filter(p => p.kind === 'class').length} class change${pendingInline.filter(p => p.kind === 'class').length > 1 ? 's' : ''}`,
          pendingInline.filter(p => p.kind === 'variant').length > 0 && `${pendingInline.filter(p => p.kind === 'variant').length} variant${pendingInline.filter(p => p.kind === 'variant').length > 1 ? 's' : ''}`,
        ].filter(Boolean).join(', ');
        return (
          <div style={{ borderBottom: `1px solid ${SB.border}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 6px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: SB.text, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{componentName}</div>
                  {storyId && (
                    <button
                      onClick={() => { setVariantOpen(o => !o); setVariantStatus('idle'); setVariantError(''); }}
                      title="Add a new story variant"
                      style={{ background: 'none', border: `1px dashed ${SB.border}`, borderRadius: SB.radiusSm, color: SB.textMuted, fontSize: 10, padding: '1px 5px', cursor: 'pointer', lineHeight: 1.4, flexShrink: 0 }}>
                      +
                    </button>
                  )}
                </div>
                {tree && (
                  <div style={{ fontSize: 10, color: SB.textMuted, marginTop: 2, fontFamily: SB.mono }}>
                    {tree.w}×{tree.h}
                    {selectedId && selectedId !== 'root' && styles && (
                      <span style={{ marginLeft: 6, color: SB.accent }}>{styles.width}×{styles.height}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => { channel.emit('DESIGN/UNDO_INLINE'); setPendingInline(prev => prev.slice(0, -1)); }}
                  disabled={pendingInline.length === 0}
                  style={{ ...s.btn, opacity: pendingInline.length === 0 ? 0.3 : 1 }}
                  title={pendingInline.length > 0 ? `Undo: ${pendingInline[pendingInline.length - 1].label}` : 'Nothing to undo'}>
                  ⏎
                </button>
                <button onClick={resetAll} style={s.btn} title="Reset all live overrides">Reset</button>
                <button onClick={() => { channel.emit('DESIGN/BUILD_TREE'); channel.emit('DESIGN/INSPECT'); setSelectedId(null); setSaveReport(null); }} style={s.btn} title="Refresh">↺</button>
                <button
                  onClick={saveToCode}
                  disabled={saving || pendingCount === 0}
                  title={pendingCount === 0 ? 'No pending changes' : `Save: ${pendingParts}`}
                  style={{
                    ...s.btn,
                    background: pendingCount > 0 ? SB.accent : 'transparent',
                    color:      pendingCount > 0 ? '#fff' : SB.textMuted,
                    borderColor: pendingCount > 0 ? SB.accent : SB.border,
                    fontWeight: pendingCount > 0 ? 600 : 400,
                    opacity: saving ? 0.6 : 1,
                    boxShadow: pendingCount > 0 ? `0 0 10px ${SB.accentGlow}` : 'none',
                  }}>
                  {saving ? '…' : '↑ Save'}
                  {pendingCount > 0 && !saving && (
                    <span style={{ marginLeft: 4, background: 'rgba(255,255,255,0.22)', color: '#fff', borderRadius: 8, fontSize: 9, padding: '0px 4px', fontWeight: 700 }}>{pendingCount}</span>
                  )}
                </button>
                {savedCount > 0 && (
                  <button
                    onClick={() => { setPrOpen(o => !o); setPrResult(null); }}
                    title="Submit saved changes as a GitHub Pull Request"
                    style={{
                      ...s.btn,
                      background: prOpen ? '#6e40c9' : 'transparent',
                      color:      prOpen ? '#fff' : '#a371f7',
                      borderColor: '#6e40c9',
                    }}>
                    ⤴ PR
                  </button>
                )}
              </div>
            </div>

            {/* ── Add variant form ──────────────────────────────────────── */}
            {variantOpen && (
              <div style={{ borderTop: `1px solid ${SB.border}`, padding: '8px 14px' }}>
                <div style={{ fontSize: 10, color: SB.textMuted, marginBottom: 5 }}>New story variant — copies current args</div>
                {variantStatus === 'done' ? (
                  <div style={{ color: SB.success, fontSize: 11 }}>✓ Added — Storybook will reload automatically</div>
                ) : (
                  <>
                    {variantStatus === 'error' && (
                      <div style={{ color: '#ff6b6b', fontSize: 10, marginBottom: 5 }}>{variantError}</div>
                    )}
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input
                        autoFocus
                        placeholder='Variant name, e.g. "Dark" or "Large"'
                        value={variantName}
                        onChange={e => setVariantName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addVariant(); if (e.key === 'Escape') setVariantOpen(false); }}
                        style={{ flex: 1, padding: '4px 8px', background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, fontFamily: SB.font, outline: 'none' }}
                      />
                      <button
                        disabled={!variantName.trim() || variantStatus === 'loading'}
                        onClick={addVariant}
                        style={{ ...s.btn, background: variantName.trim() ? SB.accent : 'transparent', color: variantName.trim() ? '#fff' : SB.textMuted, borderColor: variantName.trim() ? SB.accent : SB.border }}>
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
              <div style={{ borderTop: `1px solid ${SB.border}`, padding: '6px 14px', fontSize: 11, background: SB.bgSecondary }}>
                {saveReport.entries.length === 0 ? (
                  <span style={{ color: SB.textMuted }}>Nothing to save.</span>
                ) : (
                  <>
                    {saveReport.entries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 3 }}>
                        <span style={{ color: e.ok ? SB.success : '#ff6b6b', flexShrink: 0, lineHeight: 1.4 }}>{e.ok ? '✓' : '✗'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: e.ok ? SB.text : '#ff6b6b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                          <div style={{ color: SB.textMuted, fontSize: 10, fontFamily: SB.mono }}>{e.file}</div>
                        </div>
                      </div>
                    ))}
                    {saveReport.entries.every(e => e.ok) && (
                      <div style={{ color: SB.success, marginTop: 4, fontSize: 10 }}>All changes saved to source. Ready to commit.</div>
                    )}
                  </>
                )}
                <button onClick={() => setSaveReport(null)} style={{ marginTop: 4, background: 'none', border: 'none', color: SB.textMuted, fontSize: 10, cursor: 'pointer', padding: 0 }}>dismiss</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── PR Drawer ───────────────────────────────────────────────────── */}
      {prOpen && (
        <div style={{ borderBottom: `1px solid ${SB.border}`, background: SB.bgSecondary, padding: '10px 14px', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: SB.textMuted, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Create Pull Request
          </div>

          {prResult?.url ? (
            /* ── Success ── */
            <div>
              <div style={{ color: SB.success, fontSize: 11, marginBottom: 6 }}>✓ PR created successfully!</div>
              <a href={prResult.url} target="_blank" rel="noreferrer"
                style={{ color: SB.accent, fontSize: 11, wordBreak: 'break-all', display: 'block', marginBottom: 8 }}>
                {prResult.url}
              </a>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => window.open(prResult.url, '_blank')}
                  style={{ ...s.btn, flex: 1, background: SB.success, color: '#fff', borderColor: SB.success }}>
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
                <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: SB.radiusSm, padding: '6px 8px', color: '#ff6b6b', fontSize: 11, marginBottom: 8 }}>
                  {prResult.error}
                </div>
              )}
              <input
                placeholder="PR title — e.g. Update primary brand color to indigo"
                value={prTitle}
                onChange={e => setPrTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitPR(); }}
                style={{ width: '100%', padding: '5px 8px', background: SB.bg, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, boxSizing: 'border-box', fontFamily: SB.font, outline: 'none' }}
              />
              <textarea
                placeholder="Description (optional) — what changed and why"
                value={prBody}
                onChange={e => setPrBody(e.target.value)}
                rows={2}
                style={{ marginTop: 5, width: '100%', padding: '5px 8px', background: SB.bg, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, resize: 'vertical', boxSizing: 'border-box', fontFamily: SB.font, outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  disabled={!prTitle.trim() || prLoading}
                  onClick={submitPR}
                  style={{
                    flex: 1,
                    background: prTitle.trim() && !prLoading ? '#7c3aed' : SB.bgHover,
                    border: 'none', borderRadius: SB.radiusSm,
                    color: prTitle.trim() && !prLoading ? '#fff' : SB.textMuted,
                    padding: '6px', cursor: prTitle.trim() && !prLoading ? 'pointer' : 'default',
                    fontSize: 12, fontFamily: SB.font,
                  }}>
                  {prLoading ? 'Creating PR…' : '⤴ Create PR'}
                </button>
                <button onClick={() => { setPrOpen(false); setPrResult(null); }} style={s.btn}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: SB.textMuted }}>
                Requires <code style={{ background: SB.bgHover, padding: '1px 4px', borderRadius: SB.radiusSm, fontFamily: SB.mono }}>GITHUB_TOKEN</code> in <code style={{ background: SB.bgHover, padding: '1px 4px', borderRadius: SB.radiusSm, fontFamily: SB.mono }}>.env.local</code>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Subheader: collapse-all + canvas bg ────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 10px 3px 14px', borderBottom: `1px solid ${SB.border}`, flexShrink: 0 }}>
        {/* Canvas bg */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Canvas</span>
          <button onClick={() => setCanvasMode(m => m === 'dark' ? 'light' : 'dark')}
            style={{ fontSize: 9, fontFamily: SB.mono, padding: '1px 6px', borderRadius: SB.radiusSm, border: `1px solid ${SB.border}`, background: 'transparent', color: SB.textMuted, cursor: 'pointer' }}>
            {canvasMode === 'dark' ? '☽ Dark' : '☀️ Light'}
          </button>
          <input type="color" value={canvasBg}
            onChange={e => canvasMode === 'dark' ? setCanvasBgDark(e.target.value) : setCanvasBgLight(e.target.value)}
            title={`Canvas ${canvasMode} bg`}
            style={{ width: 20, height: 20, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, padding: 0, background: 'none', cursor: 'pointer' }} />
        </div>
        {/* Collapse/expand all */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={() => setGlobalOpenState(true)}
            title="Expand all sections"
            style={{ fontSize: 9, fontFamily: SB.mono, padding: '1px 5px', borderRadius: SB.radiusSm, border: `1px solid ${SB.border}`, background: 'transparent', color: SB.textMuted, cursor: 'pointer' }}>
            +
          </button>
          <button onClick={() => setGlobalOpenState(false)}
            title="Collapse all sections"
            style={{ fontSize: 9, fontFamily: SB.mono, padding: '1px 5px', borderRadius: SB.radiusSm, border: `1px solid ${SB.border}`, background: 'transparent', color: SB.textMuted, cursor: 'pointer' }}>
            −
          </button>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* LAYERS */}
        <Section label="Layers" noPad forceOpen={globalOpenState}>
          {tree ? (
            <LayerRow node={tree} depth={0} selectedId={selectedId}
              layerNames={layerNames} onSelect={selectLayer} onRename={renameLayer} channel={channel} />
          ) : (
            <div style={{ padding: '8px 14px', color: SB.textMuted, fontSize: 11 }}>
              {storyId ? 'Building layer tree…' : 'Select a story'}
            </div>
          )}
        </Section>

        {/* CLASSES */}
        {styles && (
          <Section label="Class" noPad forceOpen={globalOpenState}>
            <SkinInput classList={styles.classList ?? ''} styles={styles} onAddClass={addClass} onRemoveClass={removeClass} />
          </Section>
        )}

        {/* CUSTOM GLOBAL VARIANTS */}
        <Section label="Custom Variants" defaultOpen={false} forceOpen={globalOpenState}>
          <div style={{ marginBottom: 8 }}>
            {customVariants.length === 0 && (
              <div style={{ fontSize: 11, color: SB.textMuted, marginBottom: 6 }}>No custom variants yet.</div>
            )}
            {customVariants.map(cv => (
              <div key={cv.name} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: SB.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{cv.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {cv.values.map(v => (
                    <button key={v} onClick={() => applyVariant(cv.name, v)}
                      style={{ padding: '2px 8px', borderRadius: SB.radius, fontSize: 11, fontFamily: SB.font, border: `1px solid ${SB.border}`, background: 'transparent', color: SB.textMuted, cursor: 'pointer' }}>
                      {v}
                    </button>
                  ))}
                  <button onClick={() => setCustomVariants(prev => prev.filter(x => x.name !== cv.name))}
                    style={{ padding: '2px 5px', borderRadius: SB.radius, fontSize: 10, border: `1px solid ${SB.border}`, background: 'transparent', color: SB.textMuted, cursor: 'pointer' }}>
                    ×
                  </button>
                </div>
              </div>
            ))}
            {!cvOpen ? (
              <button onClick={() => setCvOpen(true)}
                style={{ fontSize: 10, color: SB.accent, background: 'none', border: `1px dashed ${SB.accent}`, borderRadius: SB.radiusSm, padding: '2px 8px', cursor: 'pointer', fontFamily: SB.font }}>
                + Add variant group
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <input placeholder="Name (e.g. size)" value={cvName} onChange={e => setCvName(e.target.value)}
                  style={{ background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 11, padding: '3px 7px', outline: 'none', fontFamily: SB.font }} />
                <input placeholder="Values comma-separated (e.g. sm,md,lg)" value={cvValues} onChange={e => setCvValues(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && cvName.trim() && cvValues.trim()) {
                      setCustomVariants(prev => [...prev, { name: cvName.trim(), values: cvValues.split(',').map(v => v.trim()).filter(Boolean) }]);
                      setCvName(''); setCvValues(''); setCvOpen(false);
                    }
                    if (e.key === 'Escape') { setCvOpen(false); setCvName(''); setCvValues(''); }
                  }}
                  style={{ background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 11, padding: '3px 7px', outline: 'none', fontFamily: SB.font }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => {
                    if (cvName.trim() && cvValues.trim()) {
                      setCustomVariants(prev => [...prev, { name: cvName.trim(), values: cvValues.split(',').map(v => v.trim()).filter(Boolean) }]);
                      setCvName(''); setCvValues(''); setCvOpen(false);
                    }
                  }} style={{ flex: 1, background: SB.accent, border: 'none', borderRadius: SB.radiusSm, color: '#fff', fontSize: 11, padding: '3px 0', cursor: 'pointer', fontFamily: SB.font }}>Add</button>
                  <button onClick={() => { setCvOpen(false); setCvName(''); setCvValues(''); }}
                    style={{ background: 'transparent', border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.textMuted, fontSize: 11, padding: '3px 8px', cursor: 'pointer', fontFamily: SB.font }}>×</button>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* COMPONENT VARIANTS */}
        {storyId && (
          <Section label="Variants" defaultOpen={true} forceOpen={globalOpenState}>
            <ComponentVariants storyId={storyId} selectedPath={selectedPath} channel={channel} onApplyVariant={applyVariant} />
          </Section>
        )}

        {/* LAYOUT */}
        <Section label="Layout" defaultOpen={true} forceOpen={globalOpenState}>
          <LayoutControls styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* SIZE */}
        <Section label="Size" defaultOpen={true} forceOpen={globalOpenState}>
          <SizeControls styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* SPACING */}
        <Section label="Spacing" defaultOpen={true} forceOpen={globalOpenState}>
          <SpacingBox styles={styles} onChangeInline={applyInlineStyle} />
        </Section>

        {/* FILL */}
        <Section label="Fill" forceOpen={globalOpenState}>
          <Row>
            <TokenField value={fillVal} tokens={tokens} filter="color" onChange={v => applyOverride(fillProp, v)} />
            <SaveBtn prop={fillProp} value={fillVal} />
          </Row>
        </Section>

        {/* TEXT STYLES — only for text leaf nodes */}
        {styles?.leafText !== undefined && (
          <Section label="Text Styles" defaultOpen={true} noPad forceOpen={globalOpenState}>
            <TextStylePicker
              classList={styles.classList ?? ''}
              tokens={tokens}
              onAddClass={addClass}
              onRemoveClass={removeClass}
              onChangeInline={applyInlineStyle}
            />
          </Section>
        )}

        {/* TEXT LAYER SIZE — width/height for text elements */}
        {styles?.leafText !== undefined && (
          <Section label="Text Size" defaultOpen={true} forceOpen={globalOpenState}>
            <SizeDimension label="Width"  prop="width"  value={styles.width}  onChangeInline={applyInlineStyle} />
            <SizeDimension label="Height" prop="height" value={styles.height} onChangeInline={applyInlineStyle} />
          </Section>
        )}

        {/* TYPOGRAPHY */}
        <Section label="Typography" defaultOpen={false} forceOpen={globalOpenState}>
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
                style={{ flex: 1, background: SB.bgSecondary, border: `1px solid ${SB.border}`, borderRadius: SB.radiusSm, color: SB.text, fontSize: 12, padding: '3px 7px', outline: 'none', fontFamily: SB.font }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = SB.accent}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = SB.border}
              />
              {pendingText && <span style={{ color: SB.warn, fontSize: 9, flexShrink: 0 }}>●</span>}
            </Row>
          )}
        </Section>

        {/* BORDER */}
        <Section label="Border" defaultOpen={false} forceOpen={globalOpenState}>
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
                  <span style={{ fontSize: 10, color: SB.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SB.mono }}
                    title={styles.boxShadow}>
                    {styles.boxShadow.length > 32 ? styles.boxShadow.slice(0, 32) + '…' : styles.boxShadow}
                  </span>
                </Row>
              )}
              {styles.filter && styles.filter !== 'none' && (
                <Row label="Filter">
                  <span style={{ fontSize: 10, color: SB.textMuted, fontFamily: SB.mono }}>{styles.filter}</span>
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
                <div style={{ fontSize: 10, color: SB.textMuted, marginBottom: 3, fontFamily: SB.mono }}>{shortName(o.prop)}</div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <TokenField value={o.value} tokens={tokens} filter={filter} onChange={v => applyOverride(o.prop, v)} />
                  <button onClick={() => saveToFile(o.prop, o.value)} style={{ ...s.iconBtn, color: saved === o.prop ? SB.success : SB.textMuted }} title="Save to global.css">{saved === o.prop ? '✓' : '↗'}</button>
                  <button onClick={() => removeOverride(o.prop)} style={{ ...s.iconBtn, color: SB.textMuted }} title="Remove">×</button>
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
