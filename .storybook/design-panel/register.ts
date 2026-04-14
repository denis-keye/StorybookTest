import { addons, types } from '@storybook/manager-api';
import React from 'react';
import { DesignPanel } from './Panel';

const ADDON_ID = 'keye/design';
const PANEL_ID = `${ADDON_ID}/panel`;

addons.register(ADDON_ID, () => {
  // Registered as PANEL so it lives in the bottom panel alongside Controls/Actions.
  // panelPosition in manager.ts is set to 'right' to move the whole panel block
  // (Controls + Actions + Design) to the right sidebar.
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Design',
    paramKey: 'design',
    render: ({ active }: { active?: boolean }) =>
      React.createElement(DesignPanel, { active: active ?? false }),
  });
});
