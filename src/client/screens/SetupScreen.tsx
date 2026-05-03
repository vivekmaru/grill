import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { CreateSessionBody } from '@/server/schemas/routes'
import { Archetype, Tone, Seniority } from '@/schema/target'
import { createSession, type CreateSessionResponse, type ApiError } from '@/client/lib/api'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Textarea } from '@/client/components/ui/textarea'
import { Label } from '@/client/components/ui/label'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/client/components/ui/card'

type FormValues = {
  resumeText: string
  targetRole: string
  targetSeniority: (typeof Seniority.options)[number]
  industry: string
  jobDescription: string
  archetype: (typeof Archetype.options)[number]
  tone: (typeof Tone.options)[number]
}

export function SetupScreen() {
  const [created, setCreated] = useState<CreateSessionResponse | null>(null)

  const form = useForm<FormValues>({
    defaultValues: {
      resumeText: '',
      targetRole: '',
      targetSeniority: 'senior',
      industry: '',
      jobDescription: '',
      archetype: 'engineering-manager',
      tone: 'skeptical',
    },
  })

  const mutation = useMutation<CreateSessionResponse, ApiError, FormValues>({
    mutationFn: async (values) => {
      const body = {
        resume: { kind: 'markdown' as const, text: values.resumeText },
        target: {
          targetRole: values.targetRole,
          targetSeniority: values.targetSeniority,
          industry: values.industry || undefined,
          jobDescription: values.jobDescription || undefined,
          persona: { archetype: values.archetype, tone: values.tone },
        },
      }
      const parsed = CreateSessionBody.parse(body)
      return createSession(parsed)
    },
    onSuccess: (res) => setCreated(res),
  })

  if (created) {
    const bulletCount = created.resume.roles.reduce((n, r) => n + r.bullets.length, 0)
    return (
      <div className="mx-auto max-w-2xl px-4">
        <Card>
          <CardHeader>
            <CardTitle>Session created</CardTitle>
            <CardDescription>
              Session ID: {created.id} — state: {created.snapshot.state}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Ingested {created.resume.roles.length} role(s) with {bulletCount} bullet(s).
            </p>
            <p className="text-muted-foreground">Critique view arrives in phase 2f.</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              Start over
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4">
      <Card>
        <CardHeader>
          <CardTitle>Start a critique session</CardTitle>
          <CardDescription>Paste your resume in markdown, choose a target, and submit.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="setup-form"
            className="space-y-6"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <div className="space-y-2">
              <Label htmlFor="resumeText">Resume (markdown)</Label>
              <Textarea
                id="resumeText"
                rows={10}
                placeholder="# Jane Doe&#10;Senior Engineer..."
                {...form.register('resumeText', { required: true, minLength: 1 })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="targetRole">Target role</Label>
                <Input
                  id="targetRole"
                  placeholder="Staff Engineer"
                  {...form.register('targetRole', { required: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetSeniority">Seniority</Label>
                <select
                  id="targetSeniority"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('targetSeniority')}
                >
                  {Seniority.options.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry (optional)</Label>
              <Input id="industry" placeholder="Fintech" {...form.register('industry')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jobDescription">Job description (optional)</Label>
              <Textarea id="jobDescription" rows={4} {...form.register('jobDescription')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="archetype">Interviewer archetype</Label>
                <select
                  id="archetype"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('archetype')}
                >
                  {Archetype.options.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tone">Tone</Label>
                <select
                  id="tone"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('tone')}
                >
                  {Tone.options.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mutation.isError ? (
              <p className="text-sm text-destructive">
                {mutation.error.code ?? 'error'}: {mutation.error.message}
              </p>
            ) : null}
          </form>
        </CardContent>
        <CardFooter>
          <Button type="submit" form="setup-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating session…' : 'Start critique'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
