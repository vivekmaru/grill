import { z } from 'zod'

export const Archetype = z.enum([
  'engineering-manager',
  'director-of-engineering',
  'tech-recruiter',
  'vp-product',
  'founder',
  'staff-principal-ic',
  'department-head',
])

export const Tone = z.enum([
  'skeptical',
  'curious',
  'adversarial',
  'coaching',
])

export const Seniority = z.enum([
  'junior', 'mid', 'senior', 'staff', 'principal', 'director', 'exec',
])

export const Persona = z.object({
  archetype: Archetype,
  tone: Tone,
  overridePrompt: z.string().optional(),
})

export const TargetContext = z.object({
  jobDescription: z.string().optional(),
  targetRole: z.string(),
  targetSeniority: Seniority,
  industry: z.string().optional(),
  persona: Persona,
})

export type Archetype = z.infer<typeof Archetype>
export type Tone = z.infer<typeof Tone>
export type Seniority = z.infer<typeof Seniority>
export type Persona = z.infer<typeof Persona>
export type TargetContext = z.infer<typeof TargetContext>
