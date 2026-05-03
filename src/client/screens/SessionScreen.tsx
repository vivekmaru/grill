import { useMemo, useState } from 'react'
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
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/client/components/ui/card'
import { GatherStep } from '@/client/components/GatherStep'

interface SessionScreenProps {
  sessionId: number
}

type LiveFlag = { bulletId: string; flag: FlagInstance }

const REWRITABLE_FLAGS = new Set([
  'vague',
  'passive',
  'length',
  'jargon',
  'unverified',
  'no-impact',
  'inflated',
  'stale',
])

function flagActionKey(bulletId: string, flagIndex: number): string {
  return `${bulletId}:${flagIndex}`
}

function flattenBullets(resume: Resume): Array<{
  section: string
  bullet: Bullet
}> {
  return [
    ...resume.roles.flatMap((role) =>
      role.bullets.map((bullet) => ({
        section: `${role.title} at ${role.company}`,
        bullet,
      })),
    ),
    ...resume.projects.flatMap((project) =>
      project.bullets.map((bullet) => ({
        section: project.name,
        bullet,
      })),
    ),
  ]
}

function BulletEditor({
  sessionId,
  bullet,
  onChanged,
}: {
  sessionId: number
  bullet: Bullet
  onChanged: () => void
}) {
  const [text, setText] = useState(bullet.text)
  const edit = useMutation({
    mutationFn: () => editBullet({ sessionId, bulletId: bullet.id, newText: text }),
    onSuccess: onChanged,
  })

  return (
    <div className="space-y-2">
      <Textarea
        aria-label={`Edit bullet ${bullet.id}`}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rows={3}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`edit-${bullet.id}`}
        onClick={() => edit.mutate()}
      >
        Edit
      </Button>
    </div>
  )
}

function FlagActions({
  sessionId,
  bullet,
  flag,
  flagIndex,
  onChanged,
  onProcessed,
}: {
  sessionId: number
  bullet: Bullet
  flag: FlagInstance
  flagIndex: number
  onChanged: () => void
  onProcessed: () => void
}) {
  const [rewriteText, setRewriteText] = useState<string | null>(null)
  const supportsRewrite = REWRITABLE_FLAGS.has(flag.flag)
  const accept = useMutation({
    mutationFn: () =>
      acceptFlag({
        sessionId,
        bulletId: bullet.id,
        flagIndex,
        newText: bullet.text,
      }),
    onSuccess: () => {
      onProcessed()
      onChanged()
    },
  })
  const skip = useMutation({
    mutationFn: () => skipFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: () => {
      onProcessed()
      onChanged()
    },
  })
  const dismiss = useMutation({
    mutationFn: () => dismissFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: () => {
      onProcessed()
      onChanged()
    },
  })
  const rewrite = useMutation({
    mutationFn: () => rewriteFlag({ sessionId, bulletId: bullet.id, flagIndex }),
    onSuccess: (res) => setRewriteText(res.candidates[0]?.text ?? null),
  })

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">
        {flag.flag} - severity {flag.severity}
      </div>
      <p className="text-sm text-muted-foreground">{flag.why}</p>
      <p className="text-sm">{flag.suggestedQuestion}</p>
      {rewriteText ? <p className="text-sm">{rewriteText}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-testid={`accept-${bullet.id}-${flagIndex}`}
          onClick={() => accept.mutate()}
        >
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`skip-${bullet.id}-${flagIndex}`}
          onClick={() => skip.mutate()}
        >
          Skip
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`dismiss-${bullet.id}-${flagIndex}`}
          onClick={() => dismiss.mutate()}
        >
          Dismiss
        </Button>
        {supportsRewrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`rewrite-${bullet.id}-${flagIndex}`}
            onClick={() => rewrite.mutate()}
          >
            Rewrite
          </Button>
        ) : (
          <span className="inline-flex h-9 items-center text-sm text-muted-foreground">
            Manual edit only
          </span>
        )}
      </div>
    </div>
  )
}

export function SessionScreen({ sessionId }: SessionScreenProps) {
  const queryClient = useQueryClient()
  const [events, setEvents] = useState<CritiqueStreamEvent[]>([])
  const [liveFlags, setLiveFlags] = useState<LiveFlag[]>([])
  const [processedFlags, setProcessedFlags] = useState<Set<string>>(() => new Set())
  const [ended, setEnded] = useState(false)

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
  }

  const critique = useMutation({
    mutationFn: () =>
      runCritiqueStream(sessionId, (event) => {
        setEvents((prev) => [...prev, event])
        if (event.type === 'flag') {
          setLiveFlags((prev) => [
            ...prev,
            { bulletId: event.bulletId, flag: event.flag },
          ])
        }
      }),
    onSuccess: invalidate,
  })

  const end = useMutation({
    mutationFn: () => endSession(sessionId),
    onSuccess: () => {
      setEnded(true)
      invalidate()
    },
  })

  const bullets = useMemo(
    () => (session.data ? flattenBullets(session.data.resume) : []),
    [session.data],
  )
  const displayState = ended ? 'generate' : session.data?.snapshot.state

  if (session.isPending) {
    return <div className="mx-auto max-w-5xl px-4 text-sm">Loading session...</div>
  }
  if (session.isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 text-sm text-destructive">
        {session.error.message}
      </div>
    )
  }

  if (session.data.snapshot.state === 'gather') {
    return (
      <div className="mx-auto max-w-2xl px-4">
        <GatherStep
          sessionId={sessionId}
          roles={session.data.resume.roles.map((r) => ({
            id: r.id,
            company: r.company,
            title: r.title,
          }))}
          onComplete={invalidate}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Session {sessionId}</h1>
            <p className="text-sm text-muted-foreground">
              {displayState} - {session.data.snapshot.provider ?? 'provider pending'}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              data-testid="export-pdf"
              href={`/api/sessions/${sessionId}/export.pdf`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Export PDF
            </a>
            <Button
              type="button"
              data-testid="run-critique"
              onClick={() => critique.mutate()}
              disabled={critique.isPending}
            >
              {critique.isPending ? 'Running...' : 'Run critique'}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="end-session"
              onClick={() => end.mutate()}
            >
              End
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Resume Preview</CardTitle>
            <CardDescription>
              {session.data.resume.contact.name || 'Unnamed candidate'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {session.data.resume.summary ? (
              <p className="text-sm">{session.data.resume.summary}</p>
            ) : null}
            {bullets.map(({ section, bullet }) => (
              <div key={bullet.id} className="space-y-2">
                <div className="text-sm font-medium">{section}</div>
                <BulletEditor
                  sessionId={sessionId}
                  bullet={bullet}
                  onChanged={invalidate}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Flag Inbox</CardTitle>
            <CardDescription>
              {events.length ? `${events.length} critique event(s)` : 'No critique run yet'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {bullets.flatMap(({ bullet }) => {
              const seen = new Set<string>()
              const combinedFlags = [
                ...bullet.flags.filter((flag) => !flag.dismissed),
                ...liveFlags
                  .filter((f) => f.bulletId === bullet.id)
                  .map((f) => f.flag),
              ].filter((flag) => {
                const duplicateKey = `${flag.flag}:${flag.span}:${flag.why}`
                if (seen.has(duplicateKey)) return false
                seen.add(duplicateKey)
                return true
              })
              return combinedFlags.flatMap((flag, flagIndex) => {
                const actionKey = flagActionKey(bullet.id, flagIndex)
                if (processedFlags.has(actionKey)) return []
                return [
                  <FlagActions
                    key={`${bullet.id}-${flagIndex}-${flag.why}`}
                    sessionId={sessionId}
                    bullet={bullet}
                    flag={flag}
                    flagIndex={flagIndex}
                    onChanged={invalidate}
                    onProcessed={() =>
                      setProcessedFlags((prev) => new Set(prev).add(actionKey))
                    }
                  />,
                ]
              })
            })}
            {!bullets.some((b) => b.bullet.flags.some((flag) => !flag.dismissed)) &&
            liveFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">Run critique to populate flags.</p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
