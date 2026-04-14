import type { Preview, Decorator } from '@storybook/react';
import '../app/globals.css';

export const parameters = {
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/i,
    },
  },
};

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals?.theme ?? 'dark';
  if (typeof document !== 'undefined') {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
  return Story();
};

const preview: Preview = {
  globalTypes: {
    theme: {
      name: 'Theme',
      defaultValue: 'dark',
    },
  },
  parameters: {
    layout: 'centered',
    ...parameters,
  },
  decorators: [withTheme],
};

export default preview;
