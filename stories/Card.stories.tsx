import type { Meta, StoryObj } from '@storybook/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../components/ui/card';
import { Button } from '../components/ui/button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>A short description of the card content.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This is the main content area of the card. You can put any content here.</p>
      </CardContent>
      <CardFooter>
        <Button variant="default">Save</Button>
        <Button variant="outline" style={{ marginLeft: 8 }}>Cancel</Button>
      </CardFooter>
    </Card>
  ),
};

export const Simple: Story = {
  render: () => (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>Simple Card</CardTitle>
      </CardHeader>
      <CardContent>
        <p>A minimal card with just a header and content.</p>
      </CardContent>
    </Card>
  ),
};

export const Small: Story = {
  render: () => (
    <Card size="sm" style={{ width: 280 }}>
      <CardHeader>
        <CardTitle>Small Card</CardTitle>
        <CardDescription>Compact card variant.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This card uses the small size variant.</p>
      </CardContent>
    </Card>
  ),
};
