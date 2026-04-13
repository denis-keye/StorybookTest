import type { StorybookConfig } from '@storybook/react-vite';
import path from 'node:path';
import { contextPlugin } from './vite-context-plugin';

const config: StorybookConfig = {
  stories: [
    '../stories/**/*.stories.@(js|jsx|ts|tsx)',
    '../components/**/*.stories.@(js|jsx|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    './design-panel/preset.js',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    const { default: tailwindVite } = await import('@tailwindcss/vite');
    return mergeConfig(config, {
      plugins: [
        tailwindVite(),
        contextPlugin(),
      ],
      resolve: {
        alias: {
          '@': path.resolve(process.cwd()),
        },
      },
    });
  },
};

export default config;
