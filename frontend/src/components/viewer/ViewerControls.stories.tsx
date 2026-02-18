import type { Meta, StoryObj } from '@storybook/react';
import { ViewerControls } from './ViewerControls';
import type { ConstructionPhase } from '@/types';

const mockPhases: ConstructionPhase[] = [
  {
    phase_number: 1,
    name: 'Site Preparation',
    start_date: '2025-01-15',
    end_date: '2025-06-30',
    color: '#ef4444',
  },
  {
    phase_number: 2,
    name: 'Foundation & Structure',
    start_date: '2025-07-01',
    end_date: '2026-03-31',
    color: '#f59e0b',
  },
  {
    phase_number: 3,
    name: 'Building Envelope',
    start_date: '2026-04-01',
    end_date: '2026-12-31',
    color: '#10b981',
  },
  {
    phase_number: 4,
    name: 'Interior Fit-Out',
    start_date: '2027-01-01',
    end_date: '2027-09-30',
    color: '#3b82f6',
  },
];

const meta: Meta<typeof ViewerControls> = {
  title: 'Viewer/ViewerControls',
  component: ViewerControls,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="relative h-[700px] w-[400px] overflow-auto bg-gray-100 p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ViewerControls>;

export const Default: Story = {
  args: {
    constructionPhases: mockPhases,
  },
};

export const NoPhases: Story = {
  args: {
    constructionPhases: [],
  },
};

export const SinglePhase: Story = {
  args: {
    constructionPhases: [
      {
        phase_number: 1,
        name: 'Construction',
        start_date: '2025-03-01',
        end_date: '2026-06-30',
        color: '#6366f1',
      },
    ],
  },
};
