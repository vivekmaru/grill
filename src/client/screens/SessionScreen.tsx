import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Resume, Bullet } from '@/schema/resume'
import type { FlagInstance } from '@/schema/flags'
import {
  acceptFlag,
  dismissFlag,
  editBullet,
  endSession,
  getSession,
  rewriteFlag,
  runCritiqueStream,
  skipFlag,
  type CritiqueStreamEvent,
} from '@/client/lib/api'
import { GatherStep } from '@/client/components/GatherStep'

// Design tokens
const C = {
  bg: '#09090b', surface: '#18181b', surfaceRaised: '#27272a',
  border: 'rgba(39,39,42,0.6)', borderSolid: '#27272a',
  primary: '#8b5cf6', primaryHover: '#7c3aed', primaryDim: 'rgba(139,92,246,0.15)',
  destructive: '#ef4444', warning: '#f59e0b', warningDim: 'rgba(245,158,11,0.1)',
  success: '#10b981', successDim: 'rgba(16,185,129,0.1)',
  z50: '#fafafa', z200: '#e4e4e7', z300: '#d4d4d8',
  z400: '#a1a1aa', z500: '#71717a', z600: '#52525b', z700: '#3f3f46',
}

const EVIDENCE_TYPES = new Set([
  'unverified','no-impact','inflated','stale',
  'specificity','seniority-mismatch','jd-mismatch','metric-risk',
])
const REWRITABLE_FLAGS = new Set([
  'vague','passive','length','jargon','unverified','no-impact','inflated','stale',
])

type IndexedFlag = { flag: FlagInstance; serverIdx: number | null }
type LiveFlag = { bulletId: string; flag: FlagInstance }

interface SessionScreenProps {
  sessionId: number
}

function flagActionKey(bulletId: string, flagIndex: number | string): string {
  return `${bulletId}:${flagIndex}`
}

function flattenBullets(resume: Resume): Array<{ section: string; bullet: Bullet }> {
  return [
    ...resume.roles.flatMap(role =>
      role.bullets.map(bullet => ({ section: `${role.title} at ${role.company}`, bullet }))
    ),
    ...resume.projects.flatMap(project =>
      project.bullets.map(bullet => ({ section: project.name, bullet }))
    ),
  ]
}

// ── Severity dots ──────────────────────────────────────────────────────────
function SeverityDots({ severity }: { severity: number }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[1,2,3].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i <= severity ? (severity === 3 ? C.warning : C.primary) : 'transparent',
          border: i <= severity ? 'none' : `1px solid ${C.z700}`,
        }} />
      ))}
    </div>
  )
}

// ── Flag type badge ────────────────────────────────────────────────────────
function FlagTypeBadge({ type }: { type: string }) {
  const isEvidence = EVIDENCE_TYPES.has(type)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: isEvidence ? C.warningDim : C.primaryDim,
      color: isEvidence ? C.warning : C.primary,
      borderRadius: 9999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
    }}>
      <span style={{ fontSize: 10 }}>{isEvidence ? '◈' : '◇'}</span>
      {type}
    </span>
  )
}

// ── Model calls bar ────────────────────────────────────────────────────────
function ModelCallsBar({ made = 0, max = 60 }: { made?: number; max?: number }) {
  const pct = Math.min(made / max, 1)
  const barColor = pct >= 0.75 ? C.warning : C.primary
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 72, height: 3, borderRadius: 9999, background: C.surfaceRaised, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: barColor, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, color: C.z600, whiteSpace: 'nowrap' }}>{made} / {max} calls</span>
    </div>
  )
}

// ── BulletEditor ───────────────────────────────────────────────────────────
function BulletEditor({ sessionId, bullet, onChanged }: {
  sessionId: number; bullet: Bullet; onChanged: () => void
}) {
  const [text, setText] = useState(bullet.text)
  useEffect(() => { setText(bullet.text) }, [bullet.text])

  const edit = useMutation({
    mutationFn: () => editBullet({ sessionId, bulletId: bullet.id, newText: text }),
    onSuccess: onChanged,
  })

  return (
    <div style={{ marginTop: 4 }}>
      <textarea
        aria-label={`Edit bullet ${bullet.id}`}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rows={3}
        style={{
          background: C.surfaceRaised, color: C.z50, width: '100%',
          border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '6px 8px', fontSize: 12, outline: 'none', resize: 'vertical',
          lineHeight: 1.6, fontFamily: 'inherit',
        }}
      />
      <button
        type="button"
        data-testid={`edit-${bullet.id}`}
        onClick={() => edit.mutate()}
        style={{
          marginTop: 4, padding: '3px 10px', fontSize: 12, borderRadius: 6, border: 'none',
          background: C.surfaceRaised, color: C.z400, cursor: 'pointer', fontFamily: 'inherit',
        }}>
        Edit
      </button>
    </div>
  )
}

// ── Resume Preview ─────────────────────────────────────────────────────────
function ResumePreview({ resume, activeBulletId, bulletStatuses, onBulletClick, sessionId, onChanged }: {
  resume: Resume
  activeBulletId: string | null
  bulletStatuses: Record<string, 'refined' | 'accepted'>
  onBulletClick: (bulletId: string) => void
  sessionId: number
  onChanged: () => void
}) {
  return (
    <div style={{ padding: '20px 32px 28px', fontFamily: 'ui-sans-serif,sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.z50, letterSpacing: '-0.01em', marginBottom: 4 }}>
          {resume.contact.name || 'Unnamed candidate'}
        </h2>
        {resume.contact.email && (
          <div style={{ fontSize: 12, color: C.z500 }}>{resume.contact.email}</div>
        )}
      </div>

      {resume.roles.map(role => (
        <div key={role.id} style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.z200 }}>{role.title}</span>
            <span style={{ fontSize: 12, color: C.z500, marginLeft: 8 }}>{role.company}</span>
          </div>
          <div style={{ paddingLeft: 8 }}>
            {role.bullets.map(b => {
              const isActive = b.id === activeBulletId
              const status = bulletStatuses[b.id]
              return (
                <div key={b.id}
                  style={{
                    marginBottom: 8, padding: '6px 8px', borderRadius: 6,
                    background: isActive ? 'rgba(139,92,246,0.07)' : 'transparent',
                    borderLeft: isActive ? '2px solid rgba(139,92,246,0.7)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => onBulletClick(b.id)}
                >
                  <div style={{ fontSize: 12, color: C.z300, lineHeight: 1.65, marginBottom: 4 }}>
                    {b.text}
                    {status === 'refined' && (
                      <span style={{ marginLeft: 6, background: C.successDim, color: C.success, fontSize: 9, padding: '1px 6px', borderRadius: 9999, fontWeight: 500 }}>
                        refined
                      </span>
                    )}
                    {status === 'accepted' && (
                      <span style={{ marginLeft: 6, background: C.surfaceRaised, color: C.z500, fontSize: 9, padding: '1px 6px', borderRadius: 9999, fontWeight: 500 }}>
                        kept
                      </span>
                    )}
                  </div>
                  <BulletEditor sessionId={sessionId} bullet={b} onChanged={onChanged} />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Flag card ──────────────────────────────────────────────────────────────
function FlagCard({ sessionId, bullet, flag, flagIndex, isLive, onChanged, onProcessed }: {
  sessionId: number
  bullet: Bullet
  flag: FlagInstance
  flagIndex: number
  isLive: boolean
  onChanged: () => void
  onProcessed: () => void
}) {
  const [panel, setPanel] = useState<null | 'rewrite' | 'edit' | 'standby'>(null)
  const [editText, setEditText] = useState(bullet.text)
  const [standbyExpanded, setStandbyExpanded] = useState(false)
  const [rewriteText, setRewriteText] = useState<string | null>(null)

  useEffect(() => {
    setPanel(null)
    setEditText(bullet.text)
    setStandbyExpanded(false)
    setRewriteText(null)
  }, [bullet.id, flagIndex, flag.flag])

  const isAmber = flag.severity === 3
  const supportsRewrite = REWRITABLE_FLAGS.has(flag.flag)

  const accept = useMutation({
    mutationFn: (newText: string) => acceptFlag({ sessionId, bulletId: bullet.id, flagIndex, newText }),
    onSuccess: () => { onProcessed(); onChanged() },
  })
  const skip = useMutation({
    mutationFn: () => skipFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: () => { onProcessed(); onChanged() },
  })
  const dismiss = useMutation({
    mutationFn: () => dismissFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: () => { onProcessed(); onChanged() },
  })
  const rewrite = useMutation({
    mutationFn: () => rewriteFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: (res) => {
      setRewriteText(res.candidates[0]?.text ?? null)
      setPanel('rewrite')
    },
  })

  const btnStyle = (variant: 'primary' | 'outline' | 'ghost' | 'amber_ghost'): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: '4px 10px', fontSize: 12, height: 28, borderRadius: 7,
      fontWeight: 500, cursor: isLive ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center',
      opacity: isLive ? 0.35 : 1,
    }
    if (variant === 'primary') return { ...base, background: C.primary, color: '#fff', border: 'none' }
    if (variant === 'outline') return { ...base, background: 'transparent', color: C.z300, border: `1px solid ${C.z700}` }
    if (variant === 'amber_ghost') return { ...base, background: 'transparent', color: C.warning, border: 'none' }
    return { ...base, background: 'transparent', color: C.z500, border: 'none' }
  }

  return (
    <div style={{
      background: 'rgba(39,39,42,0.6)', borderRadius: 14,
      border: `1px solid rgba(63,63,70,0.6)`, padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <FlagTypeBadge type={flag.flag} />
        <SeverityDots severity={flag.severity} />
      </div>

      {/* Original text */}
      <div style={{
        fontSize: 12, color: C.z500, fontStyle: 'italic', lineHeight: 1.6, marginBottom: 14,
        padding: '8px 10px', background: 'rgba(255,255,255,0.03)',
        borderRadius: 6, borderLeft: `2px solid ${C.z700}`,
      }}>
        "{bullet.text}"
      </div>

      {/* Interviewer says */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: C.z600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          The interviewer says:
        </div>
        <p style={{ fontSize: 13, color: C.z200, lineHeight: 1.65 }}>
          "{flag.why}"
        </p>
      </div>

      <div style={{ height: 1, background: C.border, marginBottom: 12 }} />

      {/* Rewrite panel */}
      {panel === 'rewrite' && (
        <div style={{ marginBottom: 12 }}>
          {rewrite.isPending ? (
            <div style={{ fontSize: 12, color: C.z500, padding: '8px 0' }}>Generating rewrites…</div>
          ) : rewriteText ? (
            <>
              <div style={{ fontSize: 11, color: C.z500, marginBottom: 10 }}>Suggested rewrite</div>
              <div style={{ padding: '10px 0' }}>
                <p style={{ fontSize: 13, color: C.z200, lineHeight: 1.6, marginBottom: 4 }}>{rewriteText}</p>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Edit panel */}
      {panel === 'edit' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.z500, marginBottom: 8 }}>Edit this bullet</div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            style={{
              background: C.surface, color: C.z50, width: '100%',
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical',
              minHeight: 80, lineHeight: 1.6,
              fontFamily: "'ui-monospace','Cascadia Code','Menlo',monospace",
            }}
          />
        </div>
      )}

      {/* Stand by panel */}
      {standbyExpanded && (
        <div style={{
          marginBottom: 12, padding: '10px 12px',
          background: isAmber ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.04)',
          borderRadius: 8, border: `1px solid ${isAmber ? 'rgba(245,158,11,0.2)' : C.border}`,
        }}>
          <p style={{ fontSize: 12, color: isAmber ? C.warning : C.z400, lineHeight: 1.6 }}>
            {isAmber
              ? 'Are you sure? This is a severity 3 claim the interviewer finds unsupported.'
              : 'Standing by tells the interviewer you can back this up in the interview.'}
          </p>
        </div>
      )}

      {/* Primary action buttons - always shown */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {supportsRewrite && (
          <button
            data-testid={`rewrite-${bullet.id}-${flagIndex}`}
            onClick={() => { setPanel(panel === 'rewrite' ? null : 'rewrite'); if (panel !== 'rewrite') rewrite.mutate() }}
            disabled={isLive}
            style={btnStyle(panel === 'rewrite' ? 'outline' : 'primary')}>
            ✦ Rewrite
          </button>
        )}
        <button
          data-testid={`accept-${bullet.id}-${flagIndex}`}
          onClick={() => accept.mutate(rewriteText ?? editText)}
          disabled={isLive}
          style={btnStyle('outline')}>
          Accept
        </button>
        <button
          data-testid={`skip-${bullet.id}-${flagIndex}`}
          onClick={() => skip.mutate()}
          disabled={isLive}
          style={{ ...btnStyle('ghost'), fontSize: 11, color: C.z600 }}>
          Skip
        </button>
        <button
          data-testid={`dismiss-${bullet.id}-${flagIndex}`}
          onClick={() => dismiss.mutate()}
          disabled={isLive}
          style={btnStyle(isAmber ? 'amber_ghost' : 'ghost')}>
          Dismiss
        </button>
        <button
          onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
          disabled={isLive}
          style={btnStyle('ghost')}>
          ✎ Edit
        </button>
        <button
          onClick={() => setStandbyExpanded(s => !s)}
          disabled={isLive}
          style={btnStyle(isAmber ? 'amber_ghost' : 'ghost')}>
          Stand by it {standbyExpanded ? '▲' : '▾'}
        </button>
      </div>
    </div>
  )
}

// ── Main SessionScreen ─────────────────────────────────────────────────────
export function SessionScreen({ sessionId }: SessionScreenProps) {
  const queryClient = useQueryClient()
  const [events, setEvents] = useState<CritiqueStreamEvent[]>([])
  const [liveFlags, setLiveFlags] = useState<LiveFlag[]>([])
  const [processedFlags, setProcessedFlags] = useState<Set<string>>(() => new Set())
  const [ended, setEnded] = useState(false)
  const [activeFlagIdx, setActiveFlagIdx] = useState(0)
  const [bulletStatuses, setBulletStatuses] = useState<Record<string, 'refined' | 'accepted'>>({})
  const [scanning, setScanning] = useState(false)

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
  })

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
  }, [queryClient, sessionId])

  const critique = useMutation({
    mutationFn: () =>
      runCritiqueStream(sessionId, (event) => {
        setEvents(prev => [...prev, event])
        if (event.type === 'flag') {
          setLiveFlags(prev => [...prev, { bulletId: event.bulletId, flag: event.flag }])
        }
      }),
    onMutate: () => setScanning(true),
    onSuccess: () => { setScanning(false); invalidate() },
    onError: () => setScanning(false),
  })

  const end = useMutation({
    mutationFn: () => endSession(sessionId),
    onSuccess: () => { setEnded(true); invalidate() },
  })

  const bullets = useMemo(
    () => (session.data ? flattenBullets(session.data.resume) : []),
    [session.data],
  )

  // Build flat pending flags list with correct server indices
  const pendingFlags = useMemo(() => {
    type PF = { flag: FlagInstance; bullet: Bullet; serverIdx: number | null; actionKey: string }
    const result: PF[] = []
    for (const { bullet } of bullets) {
      const seen = new Set<string>()
      const serverFlags: IndexedFlag[] = bullet.flags
        .map((flag, idx) => ({ flag, serverIdx: idx }))
        .filter(({ flag }) => !flag.dismissed)
        .filter(({ flag }) => {
          const key = `${flag.flag}:${flag.span}:${flag.why}`
          if (seen.has(key)) return false; seen.add(key); return true
        })
      const liveOnlyFlags: IndexedFlag[] = liveFlags
        .filter(f => f.bulletId === bullet.id)
        .map(f => f.flag)
        .filter(flag => {
          const key = `${flag.flag}:${flag.span}:${flag.why}`
          if (seen.has(key)) return false; seen.add(key); return true
        })
        .map(flag => ({ flag, serverIdx: null }))
      for (const { flag, serverIdx } of [...serverFlags, ...liveOnlyFlags]) {
        const actionKey = flagActionKey(bullet.id, serverIdx ?? 'live')
        if (!processedFlags.has(actionKey)) {
          result.push({ flag, bullet, serverIdx, actionKey })
        }
      }
    }
    return result
  }, [bullets, liveFlags, processedFlags])

  const activeFlag = pendingFlags[activeFlagIdx] ?? null
  const activeBulletId = activeFlag?.bullet.id ?? null

  // Clamp activeFlagIdx when flags are resolved
  useEffect(() => {
    if (activeFlagIdx >= pendingFlags.length && pendingFlags.length > 0) {
      setActiveFlagIdx(pendingFlags.length - 1)
    }
  }, [pendingFlags.length, activeFlagIdx])

  const displayState = ended ? 'generate' : session.data?.snapshot.state
  const callsMade = session.data?.snapshot.modelCallsMade ?? 0
  const provider = session.data?.snapshot.provider ?? 'codex'

  if (session.isPending) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, color: C.z500 }}>Loading session…</span>
      </div>
    )
  }
  if (session.isError) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, color: C.destructive }}>{session.error.message}</span>
      </div>
    )
  }

  // Gather phase
  if (session.data.snapshot.state === 'gather') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <header style={{
          height: 48, background: C.bg, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.primary }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: C.z300 }}>resume builder</span>
          </div>
        </header>
        <div style={{ paddingTop: 48 }}>
          <GatherStep
            sessionId={sessionId}
            roles={session.data.resume.roles.map(r => ({ id: r.id, company: r.company, title: r.title }))}
            onComplete={invalidate}
          />
        </div>
      </div>
    )
  }

  // Critique + generate phases
  return (
    <div style={{ height: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* TopBar */}
      <header style={{
        height: 48, flexShrink: 0, background: C.bg, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', zIndex: 200,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.primary }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: C.z300 }}>resume builder</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            data-testid="provider-badge"
            style={{
              background: C.surfaceRaised, color: C.z400,
              borderRadius: 6, padding: '2px 10px', fontSize: 11, letterSpacing: '0.02em',
            }}>
            {provider}
          </div>
          <ModelCallsBar made={callsMade} max={60} />
        </div>
      </header>

      {/* Two-pane body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: Resume preview */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', borderRight: `1px solid ${C.border}` }}>
          {/* Visually placed header for test compatibility */}
          <div style={{ padding: '16px 32px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.z600 }}>
              Resume Preview
            </span>
            <span style={{ fontSize: 11, color: C.z700 }}>Session {sessionId}</span>
          </div>
          <ResumePreview
            resume={session.data.resume}
            activeBulletId={activeBulletId}
            bulletStatuses={bulletStatuses}
            onBulletClick={(bulletId) => {
              const i = pendingFlags.findIndex(f => f.bullet.id === bulletId)
              if (i >= 0) setActiveFlagIdx(i)
            }}
            sessionId={sessionId}
            onChanged={invalidate}
          />
        </div>

        {/* RIGHT: Flag inbox */}
        <div style={{
          width: 380, flexShrink: 0, background: C.surface,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Inbox header */}
          <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.z600 }}>
                  Flag Inbox
                </span>
                {pendingFlags.length > 0 && (
                  <span style={{ fontSize: 11, color: C.z500 }}>{pendingFlags.length} remaining</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pendingFlags.length > 1 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setActiveFlagIdx(i => Math.max(0, i - 1))}
                      disabled={activeFlagIdx === 0}
                      style={{
                        width: 28, height: 28, borderRadius: 6, border: 'none',
                        background: C.surfaceRaised, color: C.z400, cursor: 'pointer',
                        fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: activeFlagIdx === 0 ? 0.35 : 1,
                      }}>◀</button>
                    <button onClick={() => setActiveFlagIdx(i => Math.min(pendingFlags.length - 1, i + 1))}
                      disabled={activeFlagIdx >= pendingFlags.length - 1}
                      style={{
                        width: 28, height: 28, borderRadius: 6, border: 'none',
                        background: C.surfaceRaised, color: C.z400, cursor: 'pointer',
                        fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: activeFlagIdx >= pendingFlags.length - 1 ? 0.35 : 1,
                      }}>▶</button>
                  </div>
                )}
                <a
                  data-testid="export-pdf"
                  href={`/api/sessions/${sessionId}/export.pdf`}
                  style={{
                    padding: '4px 10px', fontSize: 12, borderRadius: 7,
                    border: `1px solid ${C.z700}`, color: C.z300,
                    background: 'transparent', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center',
                  }}>
                  Export PDF
                </a>
              </div>
            </div>
          </div>

          {/* Scrollable inbox body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>

            {/* Scanning */}
            {scanning && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 11, color: C.z500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Scanning Resume…
                </div>
                <div style={{ fontSize: 13, color: C.z500 }}>
                  {events.length > 0 ? `${events.length} event(s) received` : 'Analyzing bullets…'}
                </div>
              </div>
            )}

            {/* Empty: no critique run yet */}
            {!scanning && pendingFlags.length === 0 && events.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                <p style={{ fontSize: 13, color: C.z500, lineHeight: 1.7, marginBottom: 16 }}>
                  Run a critique pass to surface issues.<br />
                  The interviewer will flag concerns across your bullets.
                </p>
                <button
                  data-testid="run-critique"
                  onClick={() => critique.mutate()}
                  disabled={critique.isPending}
                  style={{
                    padding: '0 20px', height: 36, borderRadius: 8, border: 'none',
                    background: C.primary, color: '#fff', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Run critique →
                </button>
              </div>
            )}

            {/* All resolved */}
            {!scanning && pendingFlags.length === 0 && events.length > 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                <div style={{ fontSize: 20, marginBottom: 10, color: C.success }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: C.z300, marginBottom: 6 }}>No flags remaining</div>
                <p style={{ fontSize: 13, color: C.z500, marginBottom: 16 }}>Run another pass or end the session.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button
                    data-testid="run-critique"
                    onClick={() => critique.mutate()}
                    style={{
                      padding: '0 16px', height: 36, borderRadius: 8,
                      border: `1px solid ${C.z700}`, background: 'transparent',
                      color: C.z300, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Run critique
                  </button>
                  <button
                    data-testid="end-session"
                    onClick={() => end.mutate()}
                    style={{
                      padding: '0 16px', height: 36, borderRadius: 8, border: 'none',
                      background: C.primary, color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    End session →
                  </button>
                </div>
              </div>
            )}

            {/* Active flag card */}
            {!scanning && activeFlag && (
              <>
                <FlagCard
                  key={`${activeFlag.bullet.id}-${String(activeFlag.serverIdx ?? 'live')}-${activeFlag.flag.why}`}
                  sessionId={sessionId}
                  bullet={activeFlag.bullet}
                  flag={activeFlag.flag}
                  flagIndex={activeFlag.serverIdx ?? -1}
                  isLive={activeFlag.serverIdx === null}
                  onChanged={() => {
                    setBulletStatuses(s => ({ ...s, [activeFlag.bullet.id]: 'refined' }))
                    invalidate()
                  }}
                  onProcessed={() => {
                    setProcessedFlags(prev => new Set(prev).add(activeFlag.actionKey))
                  }}
                />

                {/* Pagination */}
                {pendingFlags.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 }}>
                    <span style={{ fontSize: 11, color: C.z600 }}>←</span>
                    <span style={{ fontSize: 11, color: C.z400 }}>{activeFlagIdx + 1}/{pendingFlags.length}</span>
                    <span style={{ fontSize: 11, color: C.z600 }}>→</span>
                  </div>
                )}
              </>
            )}

            {/* Action row — always shown */}
            {!scanning && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
                <button
                  data-testid="run-critique"
                  onClick={() => critique.mutate()}
                  disabled={critique.isPending}
                  style={{
                    flex: 1, padding: '0 14px', height: 32, borderRadius: 7, border: 'none',
                    background: 'transparent', color: C.z500, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Run critique
                </button>
                <button
                  data-testid="end-session"
                  onClick={() => end.mutate()}
                  disabled={end.isPending}
                  style={{
                    flex: 1, padding: '0 14px', height: 32, borderRadius: 7,
                    border: `1px solid ${C.z700}`, background: 'transparent',
                    color: C.z300, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {end.isPending ? 'Ending…' : 'End session →'}
                </button>
              </div>
            )}

            {/* State display */}
            <div style={{ marginTop: 12, fontSize: 11, color: C.z700, textAlign: 'center' }}>
              {displayState}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
