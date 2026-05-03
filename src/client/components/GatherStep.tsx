import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  askGatherQuestion,
  endGather,
  recordGatherAnswer,
  skipGatherRole,
  type GatherQuestion,
} from '@/client/lib/api'
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/client/components/ui/card'

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
      <Card data-testid="gather-complete">
        <CardHeader>
          <CardTitle>Gather complete</CardTitle>
          <CardDescription>All roles covered. Ready to start critique.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            data-testid="start-critique"
            onClick={() => endMut.mutate()}
            disabled={endMut.isPending}
          >
            {endMut.isPending ? 'Starting critique…' : 'Start critique'}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (!role) return null

  return (
    <Card data-testid="gather-step">
      <CardHeader>
        <CardTitle>
          {role.title} — {role.company}
        </CardTitle>
        <CardDescription>
          Role {idx + 1} of {roles.length}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {questionQuery.isPending ? <p>Thinking…</p> : null}
        {questionQuery.isError ? (
          <p className="text-sm text-destructive">{questionQuery.error.message}</p>
        ) : null}
        {questionQuery.data && questionQuery.data.kind !== 'done' ? (
          <>
            <p className="text-base" data-testid="gather-question">
              {questionQuery.data.question}
            </p>
            <Textarea
              data-testid="gather-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="Your answer…"
            />
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          data-testid="send-answer"
          onClick={() => answerMut.mutate()}
          disabled={
            !answer.trim() ||
            answerMut.isPending ||
            questionQuery.data?.kind === 'done'
          }
        >
          {answerMut.isPending ? 'Sending…' : 'Send answer'}
        </Button>
        <Button
          variant="outline"
          data-testid="skip-role"
          onClick={() => skipMut.mutate()}
          disabled={skipMut.isPending}
        >
          Skip role
        </Button>
        <Button
          variant="ghost"
          data-testid="end-gather"
          onClick={() => endMut.mutate()}
          disabled={endMut.isPending}
        >
          End gather
        </Button>
      </CardFooter>
    </Card>
  )
}
