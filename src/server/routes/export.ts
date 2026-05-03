import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import type { AppDeps } from '@/server/deps'
import { respondWithError } from '@/server/errors'
import type { Resume } from '@/schema/resume'

function escapePdfText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function resumeLines(resume: Resume): string[] {
  const lines: string[] = []
  lines.push(resume.contact.name || 'Untitled Resume')
  const contact = [
    resume.contact.email,
    resume.contact.phone,
    resume.contact.location,
    ...resume.contact.links.map((l) => l.url),
  ].filter(Boolean)
  if (contact.length) lines.push(contact.join(' | '))
  if (resume.summary) {
    lines.push('')
    lines.push('SUMMARY')
    lines.push(...wrapText(resume.summary, 92))
  }
  if (resume.roles.length) {
    lines.push('')
    lines.push('EXPERIENCE')
    for (const role of resume.roles) {
      lines.push(
        `${role.title} | ${role.company} | ${role.startDate} - ${role.endDate ?? 'Present'}`,
      )
      if (role.summary) lines.push(...wrapText(role.summary, 92))
      for (const bullet of role.bullets) {
        for (const wrapped of wrapText(bullet.text, 88)) {
          lines.push(`- ${wrapped}`)
        }
      }
    }
  }
  if (resume.projects.length) {
    lines.push('')
    lines.push('PROJECTS')
    for (const project of resume.projects) {
      lines.push(project.name)
      if (project.description) lines.push(...wrapText(project.description, 92))
      for (const bullet of project.bullets) {
        for (const wrapped of wrapText(bullet.text, 88)) {
          lines.push(`- ${wrapped}`)
        }
      }
    }
  }
  if (resume.skills.categories.length) {
    lines.push('')
    lines.push('SKILLS')
    for (const category of resume.skills.categories) {
      lines.push(`${category.name}: ${category.items.join(', ')}`)
    }
  }
  if (resume.education.length) {
    lines.push('')
    lines.push('EDUCATION')
    for (const edu of resume.education) {
      lines.push(
        [edu.degree, edu.field, edu.institution].filter(Boolean).join(', '),
      )
    }
  }
  if (resume.certifications.length) {
    lines.push('')
    lines.push('CERTIFICATIONS')
    for (const cert of resume.certifications) {
      lines.push([cert.name, cert.issuer, cert.date].filter(Boolean).join(' | '))
    }
  }
  return lines
}

function buildPdf(resume: Resume): Uint8Array {
  const visibleLines = resumeLines(resume).slice(0, 52)
  const content = [
    'BT',
    '/F1 18 Tf',
    '54 750 Td',
    `(${escapePdfText(visibleLines[0] ?? 'Resume')}) Tj`,
    '/F1 10 Tf',
    ...visibleLines.slice(1).flatMap((line) => [
      '0 -14 Td',
      `(${escapePdfText(line)}) Tj`,
    ]),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, index) => {
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefOffset = new TextEncoder().encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

export function exportRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.get('/:id/export.pdf', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: { code: 'validation' } }, 400)
    }
    try {
      const session = Session.load(deps.db, deps.adapter, id)
      const pdf = buildPdf(session.currentResume())
      const body = pdf.buffer.slice(
        pdf.byteOffset,
        pdf.byteOffset + pdf.byteLength,
      ) as ArrayBuffer
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="resume-${id}.pdf"`,
        },
      })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
