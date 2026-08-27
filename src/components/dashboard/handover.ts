// =====================================================================
// ESG DataOps Command Center — incident queue handover artifact
// Shared builder used by BOTH the Incidents tab ("Export handover"
// button, respecting the on-screen filters) and the command palette
// (⌘K action, always the ACTIVE queue). Pure client-side functions —
// no React, no server state.
// =====================================================================

import type { DashboardState } from '@/lib/esg/dashboard'
import { fmtAge } from './shared'

export interface HandoverFilters {
  status: string
  severity: string
}

/** Trigger a client-side download of a text artifact (Blob → anchor). */
export function downloadTextFile(filename: string, text: string, mime = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Markdown shift-handover artifact of an incident queue — the "here's
 * where we are" document an L1 engineer attaches when handing the pager
 * to the next shift. Includes a queue summary, a full detail section per
 * active incident (runbook + evidence pointers) and a triage checklist.
 */
export function buildIncidentHandoverMarkdown(
  rows: DashboardState['incidents'],
  filters: HandoverFilters,
  config: DashboardState['config'],
): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const active = rows.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS')

  const bySeverity = (sev: string) => rows.filter((i) => i.severity === sev).length
  const escalated = rows.filter((i) => i.escalatedFlag).length

  const lines: string[] = []
  lines.push('# Incident Queue — Shift Handover')
  lines.push('')
  lines.push(`> Generated ${stamp} from the ESG DataOps Command Center · filter: status=${filters.status} severity=${filters.severity}`)
  lines.push('')
  lines.push('## Queue summary')
  lines.push('')
  lines.push(`- **Incidents in view:** ${rows.length} (${active.length} active)`)
  lines.push(`- **By severity:** P1 ${bySeverity('P1')} · P2 ${bySeverity('P2')} · P3 ${bySeverity('P3')} · P4 ${bySeverity('P4')}`)
  lines.push(`- **Escalated to L2:** ${escalated}`)
  lines.push(`- **Auto-escalation threshold:** ${config.escalationThresholdMinutes} minutes (config/settings.yaml)`)
  lines.push('')

  lines.push('## Queue table')
  lines.push('')
  lines.push('| Incident | Sev | Status | Type | Age | Esc | Description |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const i of rows) {
    const desc = i.shortDescription.replace(/\|/g, '\\|')
    lines.push(
      `| ${i.incidentId} | ${i.severity} | ${i.status} | ${i.incidentType.replace(/_/g, ' ')} | ${fmtAge(i.ageMinutes)} | ${i.escalatedFlag ? 'yes' : ''} | ${desc} |`,
    )
  }
  lines.push('')

  if (active.length > 0) {
    lines.push('## Active incident detail')
    lines.push('')
    for (const i of active) {
      lines.push(`### ${i.incidentId} — ${i.severity} · ${i.status}`)
      lines.push('')
      lines.push(`- **Description:** ${i.shortDescription}`)
      lines.push(`- **Created:** ${i.createdAt} · **Updated:** ${i.updatedAt}`)
      lines.push(`- **Batch / run context:** ${i.batchId ?? 'n/a'} · check: \`${i.affectedCheck ?? 'n/a'}\``)
      if (i.affectedFile) lines.push(`- **Affected file:** \`${i.affectedFile}\``)
      if (i.affectedTable) lines.push(`- **Affected table:** \`${i.affectedTable}\``)
      lines.push(`- **Runbook:** ${i.runbookLink ?? 'n/a'}`)
      lines.push(`- **Assigned:** ${i.assignedTo ?? 'unassigned'}${i.escalatedFlag ? ' · **escalated to L2**' : ''}`)
      if (i.batchId) {
        lines.push(`- **Evidence:** \`evidence/${i.batchId}/${i.incidentId}/\``)
      }
      lines.push('')
    }
  }

  lines.push('## Triage checklist for the incoming shift')
  lines.push('')
  lines.push('1. Acknowledge unacknowledged alerts in the Alerts console (severe ones first).')
  lines.push(`2. Review every P1/P2 above — if older than ${config.escalationThresholdMinutes}m and still unresolved, escalate per the escalation matrix (docs/sop_escalation_matrix.md).`)
  lines.push('3. For FILE_MISSING: confirm with the source system owner whether the feed will re-arrive; replay the batch from Pipeline Runs once re-arrived.')
  lines.push('4. For quarantined files: check data/quarantine/ and the ingestion runbook before any reload.')
  lines.push('5. Run a fresh DAG batch from the Control Room if today\'s feeds have not been processed.')
  lines.push('6. Generate a new shift handover at end of shift (Overview → Generate shift handover).')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('*Append-only operational record — regenerate from the Incidents tab or ⌘K for the latest state.*')
  lines.push('')

  return lines.join('\n')
}

/** Convenience: build + download the handover for a queue in one call. */
export function downloadIncidentHandover(
  rows: DashboardState['incidents'],
  filters: HandoverFilters,
  config: DashboardState['config'],
): void {
  const md = buildIncidentHandoverMarkdown(rows, filters, config)
  downloadTextFile(`incident_queue_handover_${new Date().toISOString().slice(0, 10)}.md`, md)
}
