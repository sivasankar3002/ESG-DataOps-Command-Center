// =====================================================================
// ESG DataOps Command Center — MODULE 6: incident management
// Simulated ServiceNow incident workflow:
//   - auto-creation from pipeline/DQ failures with severity mapping
//   - lifecycle OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED
//   - work notes journal, evidence attachment, escalation manager
// =====================================================================

import { db } from '@/lib/db'
import { loadConfig } from './config'
import { dispatchAlert } from './alerts'
import { collectEvidence, type EvidenceContext } from './evidence'
import { RUNBOOK_MAP, RUNBOOK_TITLES } from './types'
import type {
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from './types'
import type { RunLogger } from './logger'

// ---------------------------------------------------------------------
// Incident creation input
// ---------------------------------------------------------------------
export interface CreateIncidentInput {
  incidentType: IncidentType
  severity?: IncidentSeverity
  batchId?: string | null
  runId?: string | null
  pipelineName?: string
  shortDescription: string
  detailedDescription: string
  errorMessage?: string | null
  affectedFile?: string | null
  affectedTable?: string | null
  affectedCheck?: string | null
  /** Mandatory-column context for conditional severities (SCHEMA_DRIFT / NULL_VALUES). */
  mandatory?: boolean
  evidenceCtx?: EvidenceContext
  asOf?: Date
  status?: IncidentStatus
}

/** Resolve severity from the settings.yaml mapping (with conditional rules). */
export function resolveSeverity(type: IncidentType, mandatory?: boolean): IncidentSeverity {
  const config = loadConfig()
  const map = config.settings.severityMapping
  switch (type) {
    case 'SCHEMA_DRIFT':
      return mandatory ? map.SCHEMA_DRIFT_MANDATORY ?? 'P1' : map.SCHEMA_DRIFT_OPTIONAL ?? 'P2'
    case 'NULL_VALUES':
      return mandatory ? map.NULL_VALUES_MANDATORY ?? 'P2' : map.NULL_VALUES_OPTIONAL ?? 'P3'
    default:
      return map[type] ?? 'P3'
  }
}

function runbookPath(type: IncidentType): { link: string; id: string } {
  const id = RUNBOOK_MAP[type]
  const slugMap: Record<string, string> = {
    RB001: 'RB001_missing_file',
    RB002: 'RB002_empty_file',
    RB003: 'RB003_checksum_mismatch',
    RB004: 'RB004_schema_drift',
    RB005: 'RB005_row_count_mismatch',
    RB006: 'RB006_duplicate_records',
    RB007: 'RB007_null_values',
    RB008: 'RB008_load_failure',
    RB009: 'RB009_sla_breach',
    RB010: 'RB010_freshness_failure',
  }
  return { link: `docs/runbooks/${slugMap[id]}.md`, id }
}

async function nextIncidentId(): Promise<string> {
  const count = await db.incidentLog.count()
  return `INC-${(count + 1).toString().padStart(6, '0')}`
}

/** Create an incident + evidence package + alert + opening work note. */
export async function createIncident(
  input: CreateIncidentInput,
  logger?: RunLogger,
): Promise<{ incidentId: string; severity: IncidentSeverity }> {
  const config = loadConfig()
  const asOf = input.asOf ?? new Date()
  const severity = input.severity ?? resolveSeverity(input.incidentType, input.mandatory)
  const incidentId = await nextIncidentId()
  const rb = runbookPath(input.incidentType)

  const incident = await db.incidentLog.create({
    data: {
      incidentId,
      createdAt: asOf,
      updatedAt: asOf,
      batchId: input.batchId ?? null,
      runId: input.runId ?? null,
      pipelineName: input.pipelineName ?? config.settings.dagId,
      incidentType: input.incidentType,
      severity,
      status: input.status ?? 'OPEN',
      shortDescription: input.shortDescription,
      detailedDescription: input.detailedDescription,
      errorMessage: input.errorMessage ?? null,
      affectedFile: input.affectedFile ?? null,
      affectedTable: input.affectedTable ?? null,
      affectedCheck: input.affectedCheck ?? null,
      evidencePath: `evidence/${input.batchId ?? 'manual'}/${incidentId}/`,
      runbookLink: rb.link,
      assignedTo: config.settings.assignedTo,
      assignmentGroup: config.settings.assignmentGroup,
    },
  })

  await db.workNote.create({
    data: {
      incidentId,
      note: `Incident auto-created by pipeline ${incident.pipelineName} (batch ${input.batchId ?? 'n/a'}). Runbook ${rb.id} — ${RUNBOOK_TITLES[rb.id] ?? ''} attached. Evidence package generated.`,
      author: 'esg-pipeline-bot',
      createdAt: asOf,
    },
  })

  if (input.evidenceCtx) {
    try {
      await collectEvidence(incident, input.evidenceCtx)
    } catch (err) {
      console.error(`[incident] evidence collection failed for ${incidentId}:`, err)
    }
  }

  await dispatchAlert({
    alertType: input.incidentType as never,
    severity,
    message: `${incidentId}: ${input.shortDescription}`,
    batchId: input.batchId ?? null,
    runId: input.runId ?? null,
    asOf,
  })

  logger?.warn('incident', `Incident ${incidentId} [${severity}] created: ${input.shortDescription}`)
  return { incidentId, severity }
}

// ---------------------------------------------------------------------
// Incident service (manual L1 operations — "ServiceNow console")
// ---------------------------------------------------------------------
export interface IncidentDetail {
  incident: {
    incidentId: string
    createdAt: string
    updatedAt: string
    batchId: string | null
    runId: string | null
    pipelineName: string
    incidentType: string
    severity: string
    status: string
    shortDescription: string
    detailedDescription: string
    errorMessage: string | null
    affectedFile: string | null
    affectedTable: string | null
    affectedCheck: string | null
    evidencePath: string | null
    runbookLink: string | null
    assignedTo: string | null
    assignmentGroup: string
    affectedService: string
    escalatedFlag: boolean
    resolutionNotes: string | null
  }
  workNotes: { id: number; note: string; author: string; createdAt: string }[]
  evidence: {
    evidenceId: string
    evidenceType: string
    evidencePath: string
    evidenceSummary: string
  }[]
}

export async function getIncidentDetail(incidentId: string): Promise<IncidentDetail | null> {
  const incident = await db.incidentLog.findUnique({ where: { incidentId } })
  if (!incident) return null
  const [notes, evidence] = await Promise.all([
    db.workNote.findMany({ where: { incidentId }, orderBy: { createdAt: 'desc' } }),
    db.incidentEvidence.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' },
      select: {
        evidenceId: true,
        evidenceType: true,
        evidencePath: true,
        evidenceSummary: true,
        createdAt: true,
      },
    }),
  ])
  return {
    incident: {
      ...incident,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
    },
    workNotes: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    evidence: evidence.map((e) => ({
      evidenceId: e.evidenceId,
      evidenceType: e.evidenceType,
      evidencePath: e.evidencePath,
      evidenceSummary: e.evidenceSummary,
    })),
  }
}

export interface UpdateIncidentInput {
  status?: IncidentStatus
  assignedTo?: string
  resolutionNotes?: string
  escalate?: boolean
  author?: string
}

const LIFECYCLE: Record<string, IncidentStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
}

/** Update an incident with lifecycle validation (ServiceNow-style). */
export async function updateIncident(
  incidentId: string,
  input: UpdateIncidentInput,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const incident = await db.incidentLog.findUnique({ where: { incidentId } })
  if (!incident) return { ok: false, error: `Incident ${incidentId} not found` }

  const now = new Date()
  const notes: string[] = []

  if (input.status && input.status !== incident.status) {
    const allowed = LIFECYCLE[incident.status] ?? []
    if (!allowed.includes(input.status)) {
      return {
        ok: false,
        error: `Invalid transition ${incident.status} -> ${input.status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
      }
    }
    notes.push(`Status changed ${incident.status} -> ${input.status} by ${input.author ?? 'L1 Support'}`)
  }
  if (input.assignedTo && input.assignedTo !== incident.assignedTo) {
    notes.push(`Reassigned to ${input.assignedTo}`)
  }
  if (input.escalate && !incident.escalatedFlag) {
    const config = loadConfig()
    notes.push(`Escalated to ${config.settings.escalationGroup} — L1 troubleshooting steps exhausted / threshold breached`)
    await dispatchAlert({
      alertType: 'INCIDENT_ESCALATED',
      severity: incident.severity,
      message: `${incidentId} escalated: ${incident.shortDescription}`,
      batchId: incident.batchId,
      runId: incident.runId,
    })
  }
  if (input.resolutionNotes) {
    notes.push(`Resolution notes: ${input.resolutionNotes}`)
  }

  await db.incidentLog.update({
    where: { incidentId },
    data: {
      status: input.status ?? incident.status,
      assignedTo: input.escalate
        ? loadConfig().settings.escalationGroup
        : input.assignedTo ?? incident.assignedTo,
      escalatedFlag: input.escalate ? true : incident.escalatedFlag,
      resolutionNotes: input.resolutionNotes ?? (input.status === 'RESOLVED' ? incident.resolutionNotes : incident.resolutionNotes),
      updatedAt: now,
    },
  })

  for (const note of notes) {
    await db.workNote.create({
      data: { incidentId, note, author: input.author ?? 'L1 Support', createdAt: now },
    })
  }
  return { ok: true, status: input.status ?? incident.status }
}

export async function addWorkNote(
  incidentId: string,
  note: string,
  author = 'L1 Support',
): Promise<boolean> {
  const exists = await db.incidentLog.findUnique({ where: { incidentId } })
  if (!exists) return false
  await db.workNote.create({ data: { incidentId, note, author } })
  await db.incidentLog.update({ where: { incidentId }, data: { updatedAt: new Date() } })
  return true
}

/** Escalation manager: auto-escalate incidents open beyond the threshold. */
export async function runEscalationSweep(
  asOf = new Date(),
  logger?: RunLogger,
): Promise<{ escalated: string[] }> {
  const config = loadConfig()
  const threshold = config.settings.escalationThresholdMinutes * 60 * 1000
  const cutoff = new Date(asOf.getTime() - threshold)

  const stale = await db.incidentLog.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      escalatedFlag: false,
      createdAt: { lt: cutoff },
    },
  })

  const escalated: string[] = []
  for (const incident of stale) {
    const updated = await db.incidentLog.updateMany({
      where: { incidentId: incident.incidentId, escalatedFlag: false },
      data: {
        escalatedFlag: true,
        assignedTo: config.settings.escalationGroup,
        updatedAt: asOf,
      },
    })
    if (updated.count > 0) {
      await db.workNote.create({
        data: {
          incidentId: incident.incidentId,
          note: `Auto-escalated: unresolved for more than ${config.settings.escalationThresholdMinutes} minutes. Handed over to ${config.settings.escalationGroup}.`,
          author: 'escalation-manager',
          createdAt: asOf,
        },
      })
      await dispatchAlert({
        alertType: 'INCIDENT_ESCALATED',
        severity: incident.severity,
        message: `${incident.incidentId} auto-escalated after ${config.settings.escalationThresholdMinutes} min: ${incident.shortDescription}`,
        batchId: incident.batchId,
        runId: incident.runId,
        asOf,
      })
      escalated.push(incident.incidentId)
      logger?.warn('escalation', `Incident ${incident.incidentId} auto-escalated to ${config.settings.escalationGroup}`)
    }
  }
  return { escalated }
}

/** Close out old incidents as part of demo-history post-processing. */
export async function bulkLifecycle(
  incidentIds: string[],
  action: 'resolve' | 'close',
  resolutionNotes: string,
  asOf: Date,
): Promise<void> {
  for (const id of incidentIds) {
    const target: IncidentStatus = action === 'resolve' ? 'RESOLVED' : 'CLOSED'
    await db.incidentLog.update({
      where: { incidentId: id },
      data: { status: target, resolutionNotes, updatedAt: asOf },
    })
    await db.workNote.create({
      data: {
        incidentId: id,
        note: action === 'resolve' ? `Resolved: ${resolutionNotes}` : `Closed after monitoring window: ${resolutionNotes}`,
        author: 'L1 Support',
        createdAt: asOf,
      },
    })
  }
}
