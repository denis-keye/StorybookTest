import { addons, types } from '@storybook/manager-api';
import React from 'react';
import { DesignPanel } from './Panel';

const ADDON_ID = 'keye/design';
const PANEL_ID = `${ADDON_ID}/panel`;

addons.register(ADDON_ID, () => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Design',
    render: ({ active }: { active: boolean }) =>
      React.createElement(DesignPanel, { active }),
  });
});
