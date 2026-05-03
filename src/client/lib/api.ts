import type { CreateSessionBody } from '@/server/schemas/routes'
import type { Resume } from '@/schema/resume'

export interface CreateSessionResponse {
  id: number
  snapshot: { state: string; modelCallsMade: number }
  resume: Resume
}

export interface ApiError extends Error {
  status: number
  code?: string
}

export async function createSession(body: CreateSessionBody): Promise<CreateSessionResponse> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null
    const err: ApiError = Object.assign(
      new Error(errBody?.error?.message ?? `HTTP ${res.status}`),
      {
        status: res.status,
        code: errBody?.error?.code,
      },
    )
    throw err
  }
  return (await res.json()) as CreateSessionResponse
}
