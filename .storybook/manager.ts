import { addons } from '@storybook/manager-api';
import { create } from '@storybook/theming/create';

const theme = create({
  base: 'dark',

  // ── Brand ─────────────────────────────────────────────────────────────────
  brandTitle: 'Design System',
  brandUrl:   '/',

  // ── Canvas / App chrome ──────────────────────────────────────────────────
  colorPrimary:   '#029cfd',
  colorSecondary: '#029cfd',

  // ── UI surfaces ───────────────────────────────────────────────────────────
  appBg:           '#161618',
  appContentBg:    '#1c1c1f',
  appPreviewBg:    '#0f0f10',
  appBorderColor:  'rgba(255,255,255,0.07)',
  appBorderRadius: 8,

  // ── Typography ────────────────────────────────────────────────────────────
  fontBase:  '"Inter", "Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode:  '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',

  // ── Text ─────────────────────────────────────────────────────────────────
  textColor:         '#e8e8ed',
  textInverseColor:  '#161618',
  textMutedColor:    'rgba(232,232,237,0.45)',

  // ── Toolbar ───────────────────────────────────────────────────────────────
  barTextColor:         'rgba(232,232,237,0.55)',
  barHoverColor:        '#e8e8ed',
  barSelectedColor:     '#029cfd',
  barBg:                '#1c1c1f',

  // ── Form controls ─────────────────────────────────────────────────────────
  inputBg:            '#26262a',
  inputBorder:        'rgba(255,255,255,0.1)',
  inputTextColor:     '#e8e8ed',
  inputBorderRadius:  6,

  // ── Buttons ───────────────────────────────────────────────────────────────
  buttonBg:           '#26262a',
  buttonBorder:       'rgba(255,255,255,0.1)',
});

addons.setConfig({
  panelPosition: 'right',
  selectedPanel: 'keye/design/panel',
  theme,
  sidebar: {
    showRoots: true,
  },
});
