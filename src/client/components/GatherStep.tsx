import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  askGatherQuestion,
  endGather,
  recordGatherAnswer,
  skipGatherRole,
  type GatherQuestion,
} from '@/client/lib/api'

export interface GatherRoleSummary {
  id: string
  company: string
  title: string
}

export interface GatherStepProps {
  sessionId: number
  roles: GatherRoleSummary[]
  onComplete: () => void
}

export function GatherStep({ sessionId, roles, onComplete }: GatherStepProps) {
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const queryClient = useQueryClient()
  const role = roles[idx]
  const queryKey = ['gather', sessionId, role?.id ?? null] as const

  const questionQuery = useQuery<GatherQuestion>({
    queryKey,
    queryFn: () => {
      if (!role) throw new Error('no role')
      return askGatherQuestion({ sessionId, roleId: role.id })
    },
    enabled: !!role,
  })

  // Advance role automatically when AI says we're done with it
  useEffect(() => {
    if (questionQuery.data?.kind === 'done') {
      setIdx((i) => i + 1)
      setAnswer('')
    }
  }, [questionQuery.data])

  const answerMut = useMutation({
    mutationFn: async () => {
      const q = questionQuery.data
      if (!q || q.kind === 'done' || !role) return
      await recordGatherAnswer({
        sessionId,
        roleId: role.id,
        turnId: q.turnId,
        answer,
      })
    },
    onSuccess: () => {
      setAnswer('')
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const skipMut = useMutation({
    mutationFn: () => {
      if (!role) throw new Error('no role')
      return skipGatherRole({ sessionId, roleId: role.id })
    },
    onSuccess: () => {
      setIdx((i) => i + 1)
      setAnswer('')
    },
  })

  const endMut = useMutation({
    mutationFn: () => endGather({ sessionId }),
    onSuccess: () => onComplete(),
  })

  if (idx >= roles.length) {
    return (
      <div style={{ minHeight: '100vh', background: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 48 }}>
        <div style={{ textAlign: 'center', width: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 16, color: '#10b981' }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>Gather complete</div>
          <p style={{ fontSize: 13, color: '#71717a', marginBottom: 24, lineHeight: 1.65 }}>
            All roles covered. Ready to start critique.
          </p>
          <button
            data-testid="start-critique"
            onClick={() => endMut.mutate()}
            disabled={endMut.isPending}
            style={{
              padding: '0 20px', height: 44, borderRadius: 8, border: 'none',
              background: '#8b5cf6', color: '#fff', fontSize: 14, fontWeight: 500,
              cursor: endMut.isPending ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>
            {endMut.isPending ? 'Starting critique…' : 'Start critique'}
          </button>
        </div>
      </div>
    )
  }

  if (!role) return null

  return (
    <div style={{
      minHeight: '100vh', background: '#09090b', paddingTop: 48,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>

        {/* Card */}
        <div data-testid="gather-step" style={{
          background: '#18181b', borderRadius: 20,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)', overflow: 'hidden',
        }}>
          {/* Progress bar */}
          <div style={{ height: 3, background: '#27272a' }}>
            <div style={{
              height: '100%', background: '#8b5cf6',
              width: `${(idx / roles.length) * 100}%`, transition: 'width 0.4s ease',
            }} />
          </div>

          <div style={{ padding: '24px 28px 28px' }}>
            {/* Step indicator */}
            <div style={{
              fontSize: 11, fontWeight: 500, letterSpacing: '0.06em',
              color: '#52525b', textTransform: 'uppercase', marginBottom: 12,
            }}>
              Role {idx + 1} of {roles.length}: {role.title} at {role.company}
            </div>

            <div style={{ height: 1, background: 'rgba(39,39,42,0.6)', marginBottom: 20 }} />

            {/* Question */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#52525b', marginBottom: 8, letterSpacing: '0.04em' }}>
                The interviewer asks:
              </div>
              {questionQuery.isPending && (
                <p style={{ fontSize: 15, color: '#71717a', lineHeight: 1.65 }}>Thinking…</p>
              )}
              {questionQuery.isError && (
                <p style={{ fontSize: 13, color: '#ef4444' }}>{questionQuery.error.message}</p>
              )}
              {questionQuery.data && questionQuery.data.kind !== 'done' && (
                <p style={{ fontSize: 15, color: '#e4e4e7', lineHeight: 1.65 }} data-testid="gather-question">
                  "{questionQuery.data.question}"
                </p>
              )}
            </div>

            {/* Textarea */}
            {questionQuery.data && questionQuery.data.kind !== 'done' && (
              <textarea
                data-testid="gather-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your response… be specific about your contribution and the outcome."
                style={{
                  background: '#18181b', color: '#fafafa', width: '100%',
                  border: '1px solid rgba(39,39,42,0.6)', borderRadius: 8,
                  padding: '10px 12px', fontSize: 13, outline: 'none',
                  minHeight: 130, resize: 'vertical', lineHeight: 1.65,
                  fontFamily: "'ui-monospace','Cascadia Code','Menlo',monospace",
                }}
              />
            )}

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  data-testid="skip-role"
                  onClick={() => skipMut.mutate()}
                  disabled={skipMut.isPending}
                  style={{
                    padding: '0 14px', height: 36, borderRadius: 8, border: 'none',
                    background: 'transparent', color: '#71717a', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Skip role
                </button>
                <button
                  type="button"
                  data-testid="end-gather"
                  onClick={() => endMut.mutate()}
                  disabled={endMut.isPending}
                  style={{
                    padding: '0 14px', height: 36, borderRadius: 8, border: 'none',
                    background: 'transparent', color: '#52525b', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  End gather
                </button>
              </div>
              <button
                type="button"
                data-testid="send-answer"
                onClick={() => answerMut.mutate()}
                disabled={!answer.trim() || answerMut.isPending || questionQuery.data?.kind === 'done'}
                style={{
                  padding: '0 20px', height: 36, borderRadius: 8, border: 'none',
                  background: '#8b5cf6', color: '#fff', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  opacity: !answer.trim() ? 0.4 : 1,
                }}>
                {answerMut.isPending ? 'Sending…' : idx < roles.length - 1 ? 'Submit answer →' : 'Finish →'}
              </button>
            </div>
          </div>
        </div>

        {/* Role progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 20 }}>
          {roles.map((_, i) => (
            <div key={i} style={{
              width: i === idx ? 20 : 6, height: 6, borderRadius: 9999,
              background: i < idx ? '#8b5cf6' : i === idx ? '#8b5cf6' : '#3f3f46',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>
    </div>
  )
}
