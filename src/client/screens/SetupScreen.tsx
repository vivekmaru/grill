import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { CreateSessionBody } from '@/server/schemas/routes'
import { Archetype, Tone, Seniority } from '@/schema/target'
import {
  createSession,
  proposePersona,
  type CreateSessionResponse,
  type ApiError,
} from '@/client/lib/api'
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

interface SetupScreenProps {
  onSessionCreated?: (session: CreateSessionResponse) => void
}

export function SetupScreen({ onSessionCreated }: SetupScreenProps) {

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

  const proposeMut = useMutation({
    mutationFn: () => {
      const v = form.getValues()
      return proposePersona({
        targetRole: v.targetRole,
        targetSeniority: v.targetSeniority,
        industry: v.industry || undefined,
        jobDescription: v.jobDescription || undefined,
      })
    },
    onSuccess: (res) => {
      const arch = res.archetype as FormValues['archetype']
      const tone = res.tone as FormValues['tone']
      if (Archetype.options.includes(arch)) form.setValue('archetype', arch)
      if (Tone.options.includes(tone)) form.setValue('tone', tone)
    },
  })

  const [pdfData, setPdfData] = useState<string | null>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)

  async function onPdfPicked(file: File) {
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!)
    setPdfData(btoa(binary))
    setPdfName(file.name)
  }

  const mutation = useMutation<CreateSessionResponse, ApiError, FormValues>({
    mutationFn: async (values) => {
      const resume = pdfData
        ? ({ kind: 'pdf' as const, data: pdfData })
        : ({ kind: 'markdown' as const, text: values.resumeText })
      const body = {
        resume,
        target: {
          targetRole: values.targetRole,
          targetSeniority: values.targetSeniority,
          industry: values.industry || undefined,
          jobDescription: values.jobDescription || undefined,
          persona: { archetype: values.archetype, tone: values.tone },
        },
        gather: true,
      }
      const parsed = CreateSessionBody.parse(body)
      return createSession(parsed)
    },
    onSuccess: (res) => onSessionCreated?.(res),
  })

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
              <Label htmlFor="resumeText">Resume (markdown or PDF upload)</Label>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="application/pdf"
                  data-testid="resume-pdf"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0]
                    if (f) void onPdfPicked(f)
                  }}
                  className="text-sm"
                />
                {pdfName ? (
                  <span className="text-sm text-muted-foreground" data-testid="pdf-name">
                    {pdfName}
                  </span>
                ) : null}
                {pdfData ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPdfData(null)
                      setPdfName(null)
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <Textarea
                id="resumeText"
                rows={10}
                placeholder="# Jane Doe&#10;Senior Engineer..."
                disabled={!!pdfData}
                {...form.register('resumeText', {
                  validate: (v) => !!pdfData || (v?.length ?? 0) > 0,
                })}
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

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="suggest-persona"
                disabled={!form.watch('targetRole') || proposeMut.isPending}
                onClick={() => proposeMut.mutate()}
              >
                {proposeMut.isPending ? 'Suggesting…' : 'Suggest persona from JD'}
              </Button>
              {proposeMut.data ? (
                <span className="text-sm text-muted-foreground">{proposeMut.data.rationale}</span>
              ) : null}
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
