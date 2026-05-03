import { describe, it, expect } from 'bun:test'
import {
  CreateSessionBody,
  AcceptFlagBody,
  DismissFlagBody,
  EditBulletBody,
} from '@/server/schemas/routes'

const validTarget = {
  targetRole: 'Staff Engineer',
  targetSeniority: 'staff',
  persona: { archetype: 'engineering-manager', tone: 'skeptical' },
}

describe('CreateSessionBody', () => {
  it('accepts a markdown ingest with target', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'markdown', text: '# Hi' },
      target: validTarget,
    })
    expect(out.success).toBe(true)
  })

  it('rejects markdown with no text', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'markdown' },
      target: validTarget,
    })
    expect(out.success).toBe(false)
  })

  it('rejects markdown with empty text', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'markdown', text: '' },
      target: validTarget,
    })
    expect(out.success).toBe(false)
  })

  it('accepts a blank ingest', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'blank' },
      target: validTarget,
    })
    expect(out.success).toBe(true)
  })

  it('accepts a pdf ingest with base64 data', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'pdf', data: 'JVBERi0xLjQKJ...==' },
      target: validTarget,
    })
    expect(out.success).toBe(true)
  })

  it('rejects unknown resume kind', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'docx', text: 'x' },
      target: validTarget,
    })
    expect(out.success).toBe(false)
  })

  it('rejects missing target', () => {
    const out = CreateSessionBody.safeParse({
      resume: { kind: 'blank' },
    })
    expect(out.success).toBe(false)
  })
})

describe('AcceptFlagBody', () => {
  it('requires newText', () => {
    expect(AcceptFlagBody.safeParse({}).success).toBe(false)
    expect(AcceptFlagBody.safeParse({ newText: 'x' }).success).toBe(true)
  })

  it('rejects empty newText', () => {
    expect(AcceptFlagBody.safeParse({ newText: '' }).success).toBe(false)
  })
})

describe('DismissFlagBody', () => {
  it('reason is optional', () => {
    expect(DismissFlagBody.safeParse({}).success).toBe(true)
    expect(DismissFlagBody.safeParse({ reason: 'x' }).success).toBe(true)
  })
})

describe('EditBulletBody', () => {
  it('requires bulletId and newText', () => {
    expect(EditBulletBody.safeParse({}).success).toBe(false)
    expect(
      EditBulletBody.safeParse({ bulletId: 'a', newText: 'b' }).success,
    ).toBe(true)
  })

  it('rejects empty strings', () => {
    expect(
      EditBulletBody.safeParse({ bulletId: '', newText: 'x' }).success,
    ).toBe(false)
    expect(
      EditBulletBody.safeParse({ bulletId: 'x', newText: '' }).success,
    ).toBe(false)
  })
})
