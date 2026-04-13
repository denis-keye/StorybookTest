import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '../components/ui/input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  args: {
    type: 'text',
  },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text…',
  },
};

export const WithValue: Story = {
  args: {
    defaultValue: 'Hello, world!',
  },
};

export const Disabled: Story = {
  args: {
    placeholder: 'Disabled input',
    disabled: true,
  },
};

export const Password: Story = {
  args: {
    type: 'password',
    placeholder: 'Enter password…',
  },
};
