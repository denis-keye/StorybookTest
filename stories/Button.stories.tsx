import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/ui/button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Button' },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = { args: { variant: 'default', children: 'Click me' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Outline' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Secondary' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Ghost' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete' } };
