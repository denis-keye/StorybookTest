import type { Preview } from '@storybook/react';
import '../app/globals.css';

export const decorators: Preview['decorators'] = [];

export const parameters = {
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/i,
    },
  },
};

const preview: Preview = {
  parameters: {
    layout: 'centered',
    ...parameters,
  },
  decorators,
};

export default preview;
