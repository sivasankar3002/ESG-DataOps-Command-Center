// =====================================================================
// ESG DataOps Command Center — MODULE 7: evidence collection
// For every incident, a first-level troubleshooting evidence package is
// produced under evidence/{batch_id}/{incident_id}/ :
//   incident_summary.json, error_log.txt, failed_rows.csv,
//   query_results.json, screenshot_placeholder, escalation_handoff.md
// Copies of each artefact are stored in incident_evidence so the UI can
// render / download them directly.
// =====================================================================

import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { loadConfig, resolvePath } from './config'
import { toCsv } from './fsx'
import { RUNBOOK_TITLES } from './types'
import type { EvidenceType, IncidentType } from './types'

export interface RejectedRowInfo {
  recordId: string
  siteId: string | null
  readingDate: string | null
  energyKwh: number | null
  emissionsCo2e: number | null
  reason: string
  sourceFileName: string
}

export interface DqResultInfo {
  checkName: string
  status: string
  severity: string
  expectedValue?: string | null
  actualValue?: string | null
  errorDetails?: string | null
  tableName?: string | null
  columnName?: string | null
}

export interface FileSummaryInfo {
  fileName: string
  dataset: string
  fileStatus: string
  errorMessage?: string | null
}

export interface EvidenceContext {
  batchId: string
  runId: string | null
  businessDate: string
  pipelineName: string
  logText: string
  dqResults: DqResultInfo[]
  rejectedRows: RejectedRowInfo[]
  fileSummaries: FileSummaryInfo[]
  taskSummary?: { taskId: string; status: string; durationSeconds?: number | null; errorMessage?: string | null }[]
}

const BUSINESS_IMPACT: Record<IncidentType, string> = {
  FILE_MISSING:
    'Downstream ESG reporting is blocked for the affected date; sustainability KPIs (energy/emissions) will be incomplete until the feed is recovered.',
  FILE_CORRUPTED:
    'The source file cannot be parsed; the affected dataset will have a data gap until a clean copy is re-delivered.',
  SCHEMA_DRIFT:
    'The source system changed its file contract; automated loads will keep failing until the schema is confirmed and the contract updated.',
  EMPTY_FILE:
    'No records delivered for the dataset; dashboards and regulatory roll-ups will under-report for the date.',
  CHECKSUM_MISMATCH:
    'File integrity cannot be proven; loading unverified data risks corrupting the warehouse. Load is halted pending re-delivery.',
  DUPLICATE_RECORDS:
    'Duplicate meter readings would double-count consumption; duplicates are rejected, but the source-side duplication bug must be reported.',
  NULL_VALUES:
    'Mandatory attributes are missing on some records; those records cannot be attributed to a site and are rejected.',
  RANGE_VIOLATION:
    'Values outside the physical domain (negative consumption / invalid dates) were detected and rejected; source-side measurement issues suspected.',
  ROW_COUNT_MISMATCH:
    'Control totals disagree between source manifest and file content; possible data loss or truncation in transit.',
  LOAD_FAILURE:
    'The batch load aborted mid-flight; the warehouse may be partially loaded for the date and must be verified before business hours.',
  SLA_BREACH:
    'The feed arrived outside its SLA window; downstream consumers (finance, sustainability reporting) may consume stale data.',
  FRESHNESS_FAILURE:
    'The warehouse has not received fresh data within the expected period; executive dashboards are stale.',
}

const FIRST_LEVEL_ACTIONS: string[] = [
  'Checked file arrival status on the dashboard (File Ingestion tab)',
  'Reviewed the failed checks in dq_check_results for the batch',
  'Collected pipeline logs, failed rows and query results as evidence (this package)',
  'Validated whether the issue is reproducible for other dates/datasets',
]

const NEXT_STEPS: Record<IncidentType, string[]> = {
  FILE_MISSING: [
    'Contact the source system owner (see manifest source_system) and request re-delivery',
    'If re-delivery is not possible before the reporting cut-off, prepare a partial-load note for consumers',
  ],
  FILE_CORRUPTED: [
    'Request a checksum-verified re-delivery from the source system',
    'Compare quarantined file size vs manifest expectations before rejecting entirely',
  ],
  SCHEMA_DRIFT: [
    'Confirm the schema change with the source system owner',
    'If legitimate: update config/data_quality_rules.yaml required_columns and file a change ticket',
    'If not legitimate: request re-delivery in the contracted format',
  ],
  EMPTY_FILE: [
    'Confirm with the source system whether the date genuinely had no data (e.g. new sites not yet onboarded)',
    'If accidental, request re-delivery and re-run the batch',
  ],
  CHECKSUM_MISMATCH: [
    'Request re-delivery with a correct checksum manifest',
    'Check transfer logs for truncation or encoding issues in the SFTP/S3 channel',
  ],
  DUPLICATE_RECORDS: [
    'Report duplicate record_ids to the source system owner',
    'Confirm rejected duplicates did not include newer readings (late vs replayed records)',
  ],
  NULL_VALUES: [
    'Identify affected records in failed_rows.csv and report to the source owner',
    'Confirm whether site onboarding in the master is lagging the meter feed',
  ],
  RANGE_VIOLATION: [
    'Review failed rows for sensor/meter faults (negative consumption, invalid dates)',
    'Raise a data quality ticket with the site operations team',
  ],
  ROW_COUNT_MISMATCH: [
    'Reconcile expected_rows in the manifest vs actual file rows',
    'Confirm with the source owner whether records were dropped during extraction',
  ],
  LOAD_FAILURE: [
    'Review the load task error message and the offending record',
    'Quarantine verified, warehouse state verified for the batch before re-run',
    'Re-run the batch once a clean file is available',
  ],
  SLA_BREACH: [
    'Review arrival timestamp vs SLA window in file_ingestion_log',
    'If recurrent, raise a supplier performance ticket with the source system owner',
  ],
  FRESHNESS_FAILURE: [
    'Check whether upstream batches failed (Pipeline Runs tab) causing the staleness',
    'Once feeds recover, verify freshness check passes on the next run',
  ],
}

/** Build + persist the full evidence package for an incident. */
export async function collectEvidence(
  incident: {
    incidentId: string
    incidentType: string
    severity: string
    status: string
    shortDescription: string
    detailedDescription: string
    errorMessage: string | null
    affectedFile: string | null
    affectedTable: string | null
    affectedCheck: string | null
    runbookLink: string | null
    batchId: string | null
    runId: string | null
    pipelineName: string
    createdAt: Date
  },
  ctx: EvidenceContext,
): Promise<number> {
  const config = loadConfig()
  const relDir = path.join(incident.batchId ?? 'manual', incident.incidentId)
  const absDir = path.join(resolvePath(config.settings.evidenceDir), relDir)
  try {
    fs.mkdirSync(absDir, { recursive: true })
  } catch (err) {
    console.error('[evidence] mkdir failed:', err)
  }

  const runbookId = incident.runbookLink?.match(/RB\d{3}/)?.[0] ?? null
  const failedChecks = ctx.dqResults.filter((r) => r.status !== 'PASS')

  // ---- incident_summary.json -----------------------------------------
  const summaryJson = JSON.stringify(
    {
      incident_id: incident.incidentId,
      severity: incident.severity,
      status: incident.status,
      incident_type: incident.incidentType,
      short_description: incident.shortDescription,
      detailed_description: incident.detailedDescription,
      error_message: incident.errorMessage,
      batch_id: incident.batchId,
      run_id: incident.runId,
      business_date: ctx.businessDate,
      pipeline: incident.pipelineName,
      affected: {
        file: incident.affectedFile,
        table: incident.affectedTable,
        check: incident.affectedCheck,
      },
      runbook: incident.runbookLink,
      files_in_batch: ctx.fileSummaries,
      tasks: ctx.taskSummary ?? [],
      created_at: incident.createdAt,
      collected_at: new Date().toISOString(),
    },
    null,
    2,
  )

  // ---- query_results.json ---------------------------------------------
  const queryResultsJson = JSON.stringify(
    {
      incident_id: incident.incidentId,
      batch_id: ctx.batchId,
      dq_check_results: ctx.dqResults,
      note: 'Results of the SQL validation checks executed for this batch (source: dq_check_results).',
    },
    null,
    2,
  )

  // ---- failed_rows.csv --------------------------------------------------
  const failedRowsCsv =
    ctx.rejectedRows.length > 0
      ? toCsv(
          ['record_id', 'site_id', 'reading_date', 'energy_kwh', 'emissions_co2e', 'rejection_reason', 'source_file'],
          ctx.rejectedRows.map((r) => [
            r.recordId,
            r.siteId,
            r.readingDate,
            r.energyKwh,
            r.emissionsCo2e,
            r.reason,
            r.sourceFileName,
          ]),
        )
      : 'record_id,site_id,reading_date,energy_kwh,emissions_co2e,rejection_reason,source_file\n' +
        '# no rejected staging rows recorded for this incident (file-level failure)\n'

  // ---- screenshot placeholder -------------------------------------------
  const screenshotTxt = [
    'SCREENSHOT PLACEHOLDER',
    '======================',
    'Attach a screenshot of the dashboard at escalation time:',
    '  - Dashboard > Incidents > ' + incident.incidentId,
    '  - Dashboard > Data Quality (failed checks for batch ' + ctx.batchId + ')',
    'This placeholder exists so the evidence checklist stays complete when',
    'collecting packages programmatically.',
  ].join('\n')

  // ---- escalation_handoff.md ---------------------------------------------
  const handoffMd = [
    `# Escalation Handoff — ${incident.incidentId}`,
    '',
    `**Incident:** ${incident.shortDescription}`,
    `**Type:** ${incident.incidentType} | **Severity:** ${incident.severity} | **Status:** ${incident.status}`,
    `**Runbook:** ${runbookId ? `${runbookId} — ${RUNBOOK_TITLES[runbookId] ?? ''}` : 'n/a'}`,
    '',
    '## Business impact',
    BUSINESS_IMPACT[incident.incidentType as IncidentType] ?? 'Impact assessment pending.',
    '',
    '## Affected pipeline / file / table',
    `- Pipeline: ${incident.pipelineName} (batch ${incident.batchId ?? 'n/a'}, run ${incident.runId ?? 'n/a'})`,
    `- Business date: ${ctx.businessDate}`,
    `- File: ${incident.affectedFile ?? 'n/a'}`,
    `- Table: ${incident.affectedTable ?? 'n/a'}`,
    `- Check: ${incident.affectedCheck ?? 'n/a'}`,
    '',
    '## Error message',
    '```',
    incident.errorMessage ?? 'n/a',
    '```',
    '',
    '## Checks failed',
    ...(failedChecks.length > 0
      ? failedChecks.map(
          (c) => `- ${c.checkName} [${c.status}/${c.severity}] expected=${c.expectedValue ?? '-'} actual=${c.actualValue ?? '-'}`,
        )
      : ['- None recorded (task-level failure)']),
    '',
    '## First-level actions already performed',
    ...FIRST_LEVEL_ACTIONS.map((a) => `- ${a}`),
    '',
    '## Recommended next steps',
    ...(NEXT_STEPS[incident.incidentType as IncidentType] ?? []).map((s) => `- ${s}`),
    '',
    '## Senior escalation notes',
    '- Evidence package location: ' + relDir + '/',
    '- Full structured log: error_log.txt in this package',
    '- Rejected rows sample: failed_rows.csv in this package',
    '- Assign to Data Engineering L2 if next steps exceed L1 scope.',
  ].join('\n')

  // ---- persist artefacts ---------------------------------------------------
  const artefacts: { type: EvidenceType; file: string; summary: string; content: string }[] = [
    {
      type: 'INCIDENT_SUMMARY_JSON',
      file: 'incident_summary.json',
      summary: 'Machine-readable incident summary with batch, run, file and task context',
      content: summaryJson,
    },
    {
      type: 'LOG_FILE',
      file: 'error_log.txt',
      summary: 'Structured pipeline log captured during the batch run',
      content: ctx.logText || '# no log lines captured for this run',
    },
    {
      type: 'FAILED_ROWS_CSV',
      file: 'failed_rows.csv',
      summary: `${ctx.rejectedRows.length} rejected row(s) from the staging load`,
      content: failedRowsCsv,
    },
    {
      type: 'QUERY_RESULT_JSON',
      file: 'query_results.json',
      summary: 'Data quality check results executed for the batch',
      content: queryResultsJson,
    },
    {
      type: 'SCREENSHOT_PLACEHOLDER',
      file: 'screenshot_placeholder.txt',
      summary: 'Placeholder for the dashboard screenshot attached at escalation',
      content: screenshotTxt,
    },
    {
      type: 'ESCALATION_HANDOFF_MD',
      file: 'escalation_handoff.md',
      summary: 'Structured handoff document for L2 escalation',
      content: handoffMd,
    },
  ]

  let saved = 0
  for (let i = 0; i < artefacts.length; i++) {
    const a = artefacts[i]
    const evidenceId = `EVD-${incident.incidentId.replace('INC-', '')}-${i + 1}`
    try {
      fs.writeFileSync(path.join(absDir, a.file), a.content, 'utf-8')
    } catch (err) {
      console.error(`[evidence] failed writing ${a.file}:`, err)
    }
    await db.incidentEvidence.create({
      data: {
        evidenceId,
        incidentId: incident.incidentId,
        evidenceType: a.type,
        evidencePath: path.join(relDir, a.file),
        evidenceSummary: a.summary,
        content: a.content,
        createdAt: new Date(),
      },
    })
    saved++
  }
  return saved
}

/** Rebuild a minimal evidence context (used for manually created incidents). */
export function emptyEvidenceContext(pipelineName: string, businessDate: string): EvidenceContext {
  return {
    batchId: 'manual',
    runId: null,
    businessDate,
    pipelineName,
    logText: '# incident created manually via the operations console',
    dqResults: [],
    rejectedRows: [],
    fileSummaries: [],
  }
}
