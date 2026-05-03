import type { CreateSessionBody } from '@/server/schemas/routes'
import type { Resume } from '@/schema/resume'
import type { FlagInstance } from '@/schema/flags'

export interface CreateSessionResponse {
  id: number
  snapshot: SessionSnapshot
  resume: Resume
}

export interface SessionSnapshot {
  id: number
  state: string
  provider: string | null
  modelCallsMade: number
}

export interface SessionResponse {
  snapshot: SessionSnapshot
  resume: Resume
}

export interface ApiError extends Error {
  status: number
  code?: string
}

async function parseError(res: Response): Promise<ApiError> {
  const errBody = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null
  return Object.assign(
    new Error(errBody?.error?.message ?? `HTTP ${res.status}`),
    {
      status: res.status,
      code: errBody?.error?.code,
    },
  )
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw await parseError(res)
  }
  return (await res.json()) as T
}

export async function createSession(body: CreateSessionBody): Promise<CreateSessionResponse> {
  return requestJson<CreateSessionResponse>('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getSession(sessionId: number): Promise<SessionResponse> {
  return requestJson<SessionResponse>(`/api/sessions/${sessionId}`)
}

export type CritiqueStreamEvent =
  | { type: 'started'; sessionId: number; timestamp: number }
  | { type: 'flag'; bulletId: string; flag: FlagInstance }
  | {
      type: 'pass-summary'
      bulletsScanned: number
      bulletsFlagged: number
      topConcern: string
    }
  | { type: 'done'; flagCount: number; durationMs: number }
  | { type: 'error'; message: string }

export async function runCritiqueStream(
  sessionId: number,
  onEvent: (event: CritiqueStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/critique`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw await parseError(res)
  if (!res.body) throw new Error('critique response had no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      onEvent(JSON.parse(dataLine.slice(5).trim()) as CritiqueStreamEvent)
    }
  }
}

export async function acceptFlag(args: {
  sessionId: number
  bulletId: string
  flagIndex: number
  newText: string
}): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/sessions/${args.sessionId}/bullets/${encodeURIComponent(args.bulletId)}/flags/${args.flagIndex}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newText: args.newText }),
    },
  )
}

export async function skipFlag(args: {
  sessionId: number
  bulletId: string
  flagIndex: number
}): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/sessions/${args.sessionId}/bullets/${encodeURIComponent(args.bulletId)}/flags/${args.flagIndex}/skip`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
}

export async function dismissFlag(args: {
  sessionId: number
  bulletId: string
  flagIndex: number
}): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/sessions/${args.sessionId}/bullets/${encodeURIComponent(args.bulletId)}/flags/${args.flagIndex}/dismiss`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
}

export async function rewriteFlag(args: {
  sessionId: number
  bulletId: string
  flagIndex: number
}): Promise<{ candidates: Array<{ text: string }> }> {
  return requestJson<{ candidates: Array<{ text: string }> }>(
    `/api/sessions/${args.sessionId}/bullets/${encodeURIComponent(args.bulletId)}/flags/${args.flagIndex}/rewrite`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
}

export async function editBullet(args: {
  sessionId: number
  bulletId: string
  newText: string
}): Promise<void> {
  await requestJson<{ ok: true }>(`/api/sessions/${args.sessionId}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bulletId: args.bulletId, newText: args.newText }),
  })
}

export async function endSession(sessionId: number): Promise<void> {
  await requestJson<{ snapshot: SessionSnapshot }>(`/api/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
}

export type GatherQuestion =
  | { kind: 'broad' | 'followup'; turnId: number; question: string }
  | { kind: 'done'; reason: string }

export async function askGatherQuestion(args: {
  sessionId: number
  roleId: string
}): Promise<GatherQuestion> {
  return requestJson<GatherQuestion>(
    `/api/sessions/${args.sessionId}/gather/role/${encodeURIComponent(args.roleId)}/ask`,
    { method: 'POST' },
  )
}

export async function recordGatherAnswer(args: {
  sessionId: number
  roleId: string
  turnId: number
  answer: string
}): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/sessions/${args.sessionId}/gather/role/${encodeURIComponent(args.roleId)}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnId: args.turnId, answer: args.answer }),
    },
  )
}

export async function skipGatherRole(args: {
  sessionId: number
  roleId: string
}): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/sessions/${args.sessionId}/gather/role/${encodeURIComponent(args.roleId)}/skip`,
    { method: 'POST' },
  )
}

export async function endGather(args: {
  sessionId: number
}): Promise<{ snapshot: SessionSnapshot }> {
  return requestJson<{ snapshot: SessionSnapshot }>(
    `/api/sessions/${args.sessionId}/gather/end`,
    { method: 'POST' },
  )
}
