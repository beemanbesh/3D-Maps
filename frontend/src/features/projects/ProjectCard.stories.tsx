import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCard } from './ProjectCard';
import type { Project } from '@/types';

const baseProject: Project = {
  id: 'proj-001',
  name: 'Riverside Development Phase 1',
  description:
    'Mixed-use residential and commercial development along the riverside corridor featuring 200 residential units and 15,000 sqm of retail space.',
  status: 'ready',
  location: {
    latitude: 40.7128,
    longitude: -74.006,
    address: '250 Riverside Drive, New York, NY 10025',
  },
  created_at: '2025-06-15T10:30:00Z',
  updated_at: '2025-12-20T14:45:00Z',
  owner_id: 'user-001',
};

const meta: Meta<typeof ProjectCard> = {
  title: 'Features/Projects/ProjectCard',
  component: ProjectCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="w-[360px]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProjectCard>;

export const Ready: Story = {
  args: {
    project: baseProject,
  },
};

export const Draft: Story = {
  args: {
    project: {
      ...baseProject,
      id: 'proj-002',
      name: 'Highland Park Towers',
      description: 'Two residential towers with underground parking.',
      status: 'draft',
      location: undefined,
      updated_at: '2026-01-10T09:00:00Z',
    },
  },
};

export const Processing: Story = {
  args: {
    project: {
      ...baseProject,
      id: 'proj-003',
      name: 'Central Business District Expansion',
      description:
        'Large-scale commercial redevelopment encompassing three city blocks with office space, a conference center, and public plaza.',
      status: 'processing',
      location: {
        latitude: 51.5074,
        longitude: -0.1278,
        address: '1 Liverpool Street, London EC2M 7QD, UK',
      },
      updated_at: '2026-02-14T18:30:00Z',
    },
  },
};

export const Archived: Story = {
  args: {
    project: {
      ...baseProject,
      id: 'proj-004',
      name: 'Waterfront Condominiums (Completed)',
      description: 'Luxury waterfront condominiums - project completed and archived.',
      status: 'archived',
      updated_at: '2024-08-01T12:00:00Z',
    },
  },
};

export const NoDescription: Story = {
  args: {
    project: {
      ...baseProject,
      id: 'proj-005',
      name: 'Quick Sketch Project',
      description: undefined,
      status: 'draft',
      location: undefined,
      updated_at: '2026-02-16T08:00:00Z',
    },
  },
};

export const LongName: Story = {
  args: {
    project: {
      ...baseProject,
      id: 'proj-006',
      name: 'Greenfield Sustainable Mixed-Use Urban Renewal District Phase 2B - West Wing',
      description: 'A very long project name to test text wrapping behavior in the card component.',
      status: 'ready',
      updated_at: '2026-02-10T16:20:00Z',
    },
  },
};
