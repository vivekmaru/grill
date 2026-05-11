import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CreateSessionBody } from '@/server/schemas/routes'
import { Archetype, Tone, Seniority } from '@/schema/target'
import {
  createSession,
  proposePersona,
  getProviders,
  type CreateSessionResponse,
  type ApiError,
} from '@/client/lib/api'

// Design tokens
const C = {
  bg: '#09090b', surface: '#18181b', surfaceRaised: '#27272a',
  border: 'rgba(39,39,42,0.6)', primary: '#8b5cf6', primaryHover: '#7c3aed',
  primaryDim: 'rgba(139,92,246,0.15)', primaryBdr: 'rgba(139,92,246,0.4)',
  destructive: '#ef4444',
  z50: '#fafafa', z200: '#e4e4e7', z300: '#d4d4d8',
  z400: '#a1a1aa', z500: '#71717a', z600: '#52525b', z700: '#3f3f46',
}

type FormValues = {
  resumeText: string
  targetRole: string
  targetSeniority: (typeof Seniority.options)[number]
  industry: string
  jobDescription: string
  archetype: (typeof Archetype.options)[number]
  tone: (typeof Tone.options)[number]
  provider: 'claude' | 'codex'
}

interface SetupScreenProps {
  onSessionCreated?: (session: CreateSessionResponse) => void
}

export function SetupScreen({ onSessionCreated }: SetupScreenProps) {
  const [resumeTab, setResumeTab] = useState<'pdf' | 'markdown' | 'blank'>('pdf')
  const [pdfData, setPdfData] = useState<string | null>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [aiSuggested, setAiSuggested] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const form = useForm<FormValues>({
    defaultValues: {
      resumeText: '', targetRole: '', targetSeniority: 'senior',
      industry: '', jobDescription: '',
      archetype: 'engineering-manager', tone: 'skeptical', provider: 'codex',
    },
  })

  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: getProviders })

  const proposeMut = useMutation({
    mutationFn: () => {
      const v = form.getValues()
      return proposePersona({
        targetRole: v.targetRole, targetSeniority: v.targetSeniority,
        industry: v.industry || undefined, jobDescription: v.jobDescription || undefined,
      })
    },
    onSuccess: (res) => {
      const arch = res.archetype as FormValues['archetype']
      const tone = res.tone as FormValues['tone']
      if (Archetype.options.includes(arch)) { form.setValue('archetype', arch); setAiSuggested(true) }
      if (Tone.options.includes(tone)) form.setValue('tone', tone)
    },
  })

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
        ? { kind: 'pdf' as const, data: pdfData }
        : values.resumeText
        ? { kind: 'markdown' as const, text: values.resumeText }
        : { kind: 'blank' as const }
      const body = {
        resume,
        target: {
          targetRole: values.targetRole, targetSeniority: values.targetSeniority,
          industry: values.industry || undefined, jobDescription: values.jobDescription || undefined,
          persona: { archetype: values.archetype, tone: values.tone },
        },
        gather: true,
        provider: values.provider,
      }
      return createSession(CreateSessionBody.parse(body))
    },
    onSuccess: (res) => onSessionCreated?.(res),
  })

  const tabs: Array<'pdf' | 'markdown' | 'blank'> = ['pdf', 'markdown', 'blank']
  const tabLabel = { pdf: 'PDF', markdown: 'Markdown', blank: 'Blank' }

  const inp: React.CSSProperties = {
    background: C.surface, color: C.z50, width: '100%',
    border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '8px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit',
  }

  const sel: React.CSSProperties = {
    ...inp, appearance: 'none' as const, cursor: 'pointer', paddingRight: 28,
  }

  return (
    <>
      {/* TopBar */}
      <header style={{
        height: 48, background: C.bg, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.primary }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: C.z300 }}>resume builder</span>
        </div>
      </header>

      <div style={{
        minHeight: '100vh', background: C.bg, paddingTop: 48,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '80px 24px 48px',
      }}>
        <div style={{ width: '100%', maxWidth: 640 }}>

          {/* Page header */}
          <div style={{ marginBottom: 40 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: C.z50, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Resume Interrogator
            </h1>
            <p style={{ fontSize: 13, color: C.z500, marginTop: 6 }}>
              Defend every bullet. Export what survives.
            </p>
          </div>

          <form id="setup-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>

            {/* Resume Input */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.z600 }}>
                  Resume Input
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {tabs.map(t => (
                    <button key={t} type="button" onClick={() => setResumeTab(t)} style={{
                      borderRadius: 9999, padding: '3px 12px', fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                      background: resumeTab === t ? C.primaryDim : C.surfaceRaised,
                      color: resumeTab === t ? C.primary : C.z400,
                      outline: resumeTab === t ? `1px solid rgba(139,92,246,0.4)` : 'none',
                    }}>{tabLabel[t]}</button>
                  ))}
                </div>
              </div>

              {resumeTab === 'pdf' && (
                pdfData ? (
                  <div style={{
                    background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`,
                    padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span style={{ fontSize: 18 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.z300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        data-testid="pdf-name">{pdfName}</div>
                    </div>
                    <button type="button" onClick={() => { setPdfData(null); setPdfName(null) }}
                      style={{ background: 'none', border: 'none', color: C.z500, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault(); setDragOver(false)
                      const f = e.dataTransfer.files[0]
                      if (f && f.type === 'application/pdf') void onPdfPicked(f)
                    }}
                    style={{
                      height: 144, borderRadius: 12, cursor: 'pointer',
                      border: `2px dashed ${dragOver ? 'rgba(139,92,246,0.6)' : C.z700}`,
                      background: dragOver ? C.primaryDim : C.surface,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.z600} strokeWidth="1.5">
                      <path d="M12 15V3m0 0-4 4m4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 18v1a2 2 0 002 2h14a2 2 0 002-2v-1" strokeLinecap="round"/>
                    </svg>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: C.z400 }}>Drop your PDF here, or click to browse</div>
                      <div style={{ fontSize: 11, color: C.z600, marginTop: 3 }}>.pdf up to 10 MB</div>
                    </div>
                    <input
                      ref={fileRef} type="file" accept=".pdf"
                      data-testid="resume-pdf"
                      onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void onPdfPicked(f) }}
                      style={{ display: 'none' }}
                    />
                  </div>
                )
              )}

              {/* Markdown textarea — always in DOM for test/form wiring; hidden when not on markdown tab */}
              <textarea
                id="resumeText"
                {...form.register('resumeText', { validate: (v) => !!pdfData || (v?.length ?? 0) > 0 })}
                placeholder={`# Jane Doe\njane@example.com\n\n## Senior Engineer · Acme Corp (2022–2024)\n- Led improvements to the CI pipeline…`}
                style={{
                  ...inp, minHeight: 180, resize: 'vertical', lineHeight: 1.65,
                  fontFamily: "'ui-monospace','Cascadia Code','Menlo',monospace",
                  display: resumeTab === 'markdown' ? 'block' : 'none',
                }}
              />

              {resumeTab === 'blank' && (
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
                  padding: '20px 16px', textAlign: 'center',
                }}>
                  <p style={{ fontSize: 13, color: C.z500, fontStyle: 'italic' }}>
                    You'll build your resume from scratch during the session.
                  </p>
                </div>
              )}
            </div>

            {/* Target Context */}
            <div style={{ marginBottom: 28 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.z600 }}>
                Target Context
              </span>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                <input id="targetRole" {...form.register('targetRole', { required: true })}
                  placeholder="Target role (e.g. Staff Engineer)" style={inp} />
                <div style={{ position: 'relative' }}>
                  <select {...form.register('targetSeniority')} style={sel}>
                    {Seniority.options.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    width="12" height="12" viewBox="0 0 12 12">
                    <path d="M3 5l3 3 3-3" stroke={C.z500} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <input {...form.register('industry')} placeholder="Industry (optional — e.g. fintech, healthcare)" style={inp} />
              </div>
              <div style={{ marginTop: 10 }}>
                <textarea {...form.register('jobDescription')} placeholder="Paste the job posting to calibrate the interviewer's standards…"
                  style={{ ...inp, minHeight: 100, resize: 'vertical', lineHeight: 1.65 }} />
              </div>
            </div>

            {/* Interviewer Persona */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.z600 }}>
                  Interviewer Persona
                </span>
                <button type="button"
                  data-testid="suggest-persona"
                  disabled={!form.watch('targetRole') || proposeMut.isPending}
                  onClick={() => proposeMut.mutate()}
                  style={{
                    background: 'none', border: 'none', color: proposeMut.isPending ? C.z500 : C.primary,
                    fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                    fontFamily: 'inherit', opacity: !form.watch('targetRole') ? 0.4 : 1,
                  }}>
                  {proposeMut.isPending ? 'Analyzing JD…' : '✦ Suggest from JD'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <select {...form.register('archetype')} style={sel}>
                    {Archetype.options.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    width="12" height="12" viewBox="0 0 12 12">
                    <path d="M3 5l3 3 3-3" stroke={C.z500} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ position: 'relative' }}>
                  <select {...form.register('tone')} style={sel}>
                    {Tone.options.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    width="12" height="12" viewBox="0 0 12 12">
                    <path d="M3 5l3 3 3-3" stroke={C.z500} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              {aiSuggested && (
                <div style={{
                  marginTop: 10, display: 'inline-flex', alignItems: 'flex-start', gap: 6,
                  background: 'rgba(139,92,246,0.08)', border: `1px solid rgba(139,92,246,0.4)`,
                  borderRadius: 8, padding: '8px 12px',
                }}>
                  <span style={{ color: C.primary, fontSize: 12, marginTop: 1 }}>✦</span>
                  <div>
                    <div style={{ fontSize: 12, color: C.primary, fontWeight: 500 }}>
                      AI suggested persona
                    </div>
                    <div style={{ fontSize: 11, color: C.z500, marginTop: 2 }}>
                      {proposeMut.data?.rationale ?? 'Based on the JD context.'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Provider */}
            <div style={{ marginBottom: 28 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.z600 }}>
                Provider
              </span>
              <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
                {(['codex', 'claude'] as const).map((p) => {
                  const available = providers?.available?.includes(p) ?? p === 'codex'
                  return (
                    <label key={p} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      cursor: available ? 'pointer' : 'not-allowed',
                      opacity: available ? 1 : 0.4,
                    }}>
                      <input type="radio" value={p} disabled={!available}
                        data-testid={`provider-${p}`}
                        {...form.register('provider')}
                        style={{ accentColor: C.primary }} />
                      <span style={{ fontSize: 13, color: C.z300, textTransform: 'capitalize' }}>{p}</span>
                      {!available && (
                        <span style={{ fontSize: 11, color: C.z600 }}>(not installed)</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Error */}
            {mutation.isError && (
              <div style={{ color: C.destructive, fontSize: 13, marginBottom: 12 }}>
                {mutation.error.code ?? 'error'}: {mutation.error.message}
              </div>
            )}

            {/* Submit */}
            <button type="submit" form="setup-form" disabled={mutation.isPending} style={{
              width: '100%', padding: '0 20px', height: 44, borderRadius: 8, border: 'none',
              background: mutation.isPending ? C.primaryHover : C.primary,
              color: '#fff', fontSize: 14, fontWeight: 500, cursor: mutation.isPending ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'inherit',
            }}>
              {mutation.isPending ? 'Setting up session…' : 'Start interrogation →'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
