import { z } from 'zod'
import { FlagInstance } from './flags'

export const ImpactMetric = z.object({
  value: z.string(),
  unit: z.enum(['percent', 'currency', 'count', 'time', 'other']),
  baseline: z.string().optional(),
  verified: z.boolean(),
})

export const Bullet = z.object({
  id: z.string(),
  text: z.string(),
  metrics: z.array(ImpactMetric).default([]),
  skills: z.array(z.string()).default([]),
  impactScore: z.number().min(0).max(10).optional(),
  flags: z.array(FlagInstance).default([]),
  sourceTurnIds: z.array(z.string()).default([]),
  status: z.enum(['draft', 'flagged', 'refined', 'accepted']),
})

export type Bullet = z.infer<typeof Bullet>
export type ImpactMetric = z.infer<typeof ImpactMetric>

export const Role = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  startDate: z.string(), // ISO yyyy-mm
  endDate: z.string().nullable(), // null = present
  summary: z.string().optional(),
  bullets: z.array(Bullet),
})

export const Education = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url().optional(),
  description: z.string(),
  bullets: z.array(Bullet),
  techStack: z.array(z.string()).default([]),
})

export const SkillCategory = z.object({
  name: z.string(),
  items: z.array(z.string()),
})

export const Resume = z.object({
  version: z.literal(1),
  contact: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.object({
      label: z.string(),
      url: z.string().url(),
    })).default([]),
  }),
  summary: z.string().optional(),
  roles: z.array(Role),
  education: z.array(Education).default([]),
  projects: z.array(Project).default([]),
  skills: z.object({
    categories: z.array(SkillCategory),
  }).default({ categories: [] }),
  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string(),
    date: z.string().optional(),
  })).default([]),
})

export type Resume = z.infer<typeof Resume>
export type Role = z.infer<typeof Role>
export type Education = z.infer<typeof Education>
export type Project = z.infer<typeof Project>
export type SkillCategory = z.infer<typeof SkillCategory>
