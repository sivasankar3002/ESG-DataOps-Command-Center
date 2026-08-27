import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export interface DocEntry {
  id: string
  title: string
  file: string
  content: string
}

const RUNBOOK_DIR = 'docs/runbooks'
const SOP_GLOB = [
  'sop_daily_monitoring.md',
  'sop_file_arrival_check.md',
  'sop_validation_failure_handling.md',
  'sop_incident_creation_and_update.md',
  'sop_escalation_matrix.md',
  'sop_daily_status_reporting.md',
]

function titleFromContent(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : fallback
}

/** GET /api/runbooks — runbook + SOP library rendered from docs/. */
export async function GET() {
  try {
    const runbooks: DocEntry[] = []
    const runbookDir = path.join(process.cwd(), RUNBOOK_DIR)
    if (fs.existsSync(runbookDir)) {
      const files = fs.readdirSync(runbookDir).filter((f) => f.endsWith('.md')).sort()
      for (const file of files) {
        const content = fs.readFileSync(path.join(runbookDir, file), 'utf-8')
        runbooks.push({
          id: file.replace('.md', ''),
          title: titleFromContent(content, file),
          file: `${RUNBOOK_DIR}/${file}`,
          content,
        })
      }
    }

    const sops: DocEntry[] = []
    for (const file of SOP_GLOB) {
      const abs = path.join(process.cwd(), 'docs', file)
      if (fs.existsSync(abs)) {
        const content = fs.readFileSync(abs, 'utf-8')
        sops.push({
          id: file.replace('.md', ''),
          title: titleFromContent(content, file),
          file: `docs/${file}`,
          content,
        })
      }
    }

    return NextResponse.json({ runbooks, sops })
  } catch (err) {
    console.error('[api/runbooks] failed:', err)
    return NextResponse.json({ error: 'Failed to load runbooks' }, { status: 500 })
  }
}
