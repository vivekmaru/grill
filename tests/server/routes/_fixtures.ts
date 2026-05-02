import type { TargetContext } from '@/schema/target'

export const sampleResumeJson = {
  version: 1,
  contact: { name: 'Vivek Maru', email: 'vivek@example.com', links: [] },
  summary: 'Senior engineer.',
  roles: [
    {
      id: 'will-be-replaced',
      company: 'Acme',
      title: 'Senior Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [
        {
          id: 'will-be-replaced',
          text: 'Built CI pipeline',
          status: 'draft',
          metrics: [],
          skills: [],
          flags: [],
          sourceTurnIds: [],
        },
      ],
    },
  ],
  education: [],
  projects: [],
  skills: { categories: [] },
  certifications: [],
}

export const sampleTarget: TargetContext = {
  targetRole: 'Staff Engineer',
  targetSeniority: 'staff',
  persona: { archetype: 'engineering-manager', tone: 'skeptical' },
}
