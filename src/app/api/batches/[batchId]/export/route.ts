// =====================================================================
// ESG DataOps Command Center — Batch Lineage Markdown Export
// GET /api/batches/[batchId]/export?format=md
// Returns the full lineage of a batch as a Markdown handover artifact
// that an L1 engineer can paste into a ticket, an email, or a postmortem
// doc. Mirrors the Batch Explorer view one-to-one so the on-screen view
// and the export never drift apart.
// =====================================================================

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadConfig } from '@/lib/esg/config'
import { batchIdToDate } from '@/lib/esg/reconciliation'

export const dynamic = 'force-dynamic'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '-'
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

/**
 * GET /api/batches/[batchId]/export?format=md
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params
    const config = loadConfig()

    const [tasks, files, dqChecks, incidents, facts, stagingEnergy, stagingSites, alerts] =
      await Promise.all([
        db.jobRunAudit.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } }),
        db.fileIngestionLog.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } }),
        db.dqCheckResult.findMany({ where: { batchId }, orderBy: { checkId: 'asc' } }),
        db.incidentLog.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } }),
        db.factEnergyEmissions.findMany({
          where: { batchId },
          select: { energyKwh: true, emissionsCo2e: true, siteId: true },
        }),
        db.stagingEnergyData.findMany({
          where: { batchId },
          select: { validationStatus: true, dataset: true, rejectionReason: true, energyKwh: true, emissionsCo2e: true },
        }),
        db.stagingSiteMaster.findMany({
          where: { batchId },
          select: { validationStatus: true, rejectionReason: true },
        }),
        db.alertLog.findMany({ where: { batchId }, orderBy: { createdAt: 'desc' } }),
      ])

    if (tasks.length === 0 && files.length === 0 && incidents.length === 0) {
      return NextResponse.json(
        { error: `No lineage records found for batch ${batchId}` },
        { status: 404 },
      )
    }

    // ---- batch summary ----------------------------------------------------
    const startedAt = tasks.reduce<Date | null>(
      (m, t) => (m === null || t.startTime < m ? t.startTime : m),
      null,
    )
    const endedAt = tasks.reduce<Date | null>(
      (m, t) => (t.endTime && (m === null || t.endTime > m) ? t.endTime : m),
      null,
    )
    const failedTasks = tasks.filter((t) => t.status === 'FAILED').length
    const skippedTasks = tasks.filter((t) => t.status === 'SKIPPED').length
    const status =
      failedTasks > 0
        ? 'FAILED'
        : skippedTasks > 0
          ? 'PARTIAL'
          : tasks.length > 0
            ? 'SUCCESS'
            : 'NO_RUNS'
    const totalDuration =
      startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10
        : Math.round(tasks.reduce((a, t) => a + (t.durationSeconds ?? 0), 0) * 10) / 10

    // ---- staging + recon ------------------------------------------------
    const energyStaging = stagingEnergy.filter((s) => s.dataset === 'energy_consumption')
    const validStaging = energyStaging.filter((s) => s.validationStatus === 'VALID')
    const energyValid = validStaging.length
    const energyRejected = energyStaging.filter((s) => s.validationStatus === 'REJECTED').length
    const carbonStaging = stagingEnergy.filter((s) => s.dataset === 'carbon_emissions')
    const carbonValid = carbonStaging.filter((s) => s.validationStatus === 'VALID').length
    const carbonRejected = carbonStaging.filter((s) => s.validationStatus === 'REJECTED').length
    const siteMasterValid = stagingSites.filter((s) => s.validationStatus === 'VALID').length
    const siteMasterRejected = stagingSites.filter((s) => s.validationStatus === 'REJECTED').length
    const rejectionReasons = [
      ...new Set(
        [...stagingEnergy, ...stagingSites]
          .filter((s) => s.rejectionReason)
          .map((s) => s.rejectionReason as string),
      ),
    ]

    const sourceCount = validStaging.length
    const sourceEnergy = validStaging.reduce((a, r) => a + (r.energyKwh ?? 0), 0)
    const sourceEmissions = validStaging.reduce((a, r) => a + (r.emissionsCo2e ?? 0), 0)
    const targetCount = facts.length
    const targetEnergy = facts.reduce((a, f) => a + f.energyKwh, 0)
    const targetEmissions = facts.reduce((a, f) => a + f.emissionsCo2e, 0)
    const reconStatus =
      sourceCount !== targetCount ||
      Math.abs(sourceEnergy - targetEnergy) > config.settings.aggregateTolerance
        ? 'FAIL'
        : 'PASS'

    const dqPass = dqChecks.filter((c) => c.status === 'PASS').length
    const dqFail = dqChecks.filter((c) => c.status === 'FAIL').length
    const dqWarn = dqChecks.filter((c) => c.status === 'WARN').length
    const siteSet = new Set(facts.map((f) => f.siteId))

    // ---- markdown ------------------------------------------------
    const md: string[] = []
    md.push(`# Batch lineage handover — ${batchId}`)
    md.push('')
    md.push(`> Generated by ESG DataOps Command Center on ${fmtTime(new Date().toISOString())}.`)
    md.push(`> All facts below are read live from the operational database; paste freely into tickets, emails or postmortem docs.`)
    md.push('')
    md.push('## Batch summary')
    md.push('')
    md.push('| Field | Value |')
    md.push('|---|---|')
    md.push(`| Batch id | \`${batchId}\` |`)
    md.push(`| Business date | ${batchIdToDate(batchId)} |`)
    md.push(`| DAG | ${tasks[0]?.dagId ?? 'esg_daily_ingestion'} |`)
    md.push(`| Status | **${status}** |`)
    md.push(`| Started | ${fmtTime(startedAt ? startedAt.toISOString() : null)} |`)
    md.push(`| Ended | ${fmtTime(endedAt ? endedAt.toISOString() : null)} |`)
    md.push(`| Wall clock | ${totalDuration}s |`)
    md.push(`| Tasks | ${tasks.length} total · ${failedTasks} failed · ${skippedTasks} skipped |`)
    md.push('')

    md.push('## DAG tasks')
    md.push('')
    md.push('| # | Task | Type | Started | Duration | Read | Loaded | Rejected | Status |')
    md.push('|---|---|---|---|---|---|---|---|---|')
    for (const t of tasks) {
      md.push(
        `| ${t.sequence + 1} | ${t.taskId} | ${t.jobType} | ${fmtTime(t.startTime.toISOString()).slice(11)} | ${t.durationSeconds !== null ? `${t.durationSeconds.toFixed(1)}s` : '-'} | ${fmtNum(t.rowsRead)} | ${fmtNum(t.rowsLoaded)} | ${fmtNum(t.rowsRejected)} | ${t.status} |`,
      )
    }
    md.push('')

    md.push('## Files ingested')
    md.push('')
    if (files.length === 0) {
      md.push('No files recorded for this batch.')
    } else {
      md.push('| File | Dataset | Zone | Checksum | Size | Status |')
      md.push('|---|---|---|---|---|---|')
      for (const f of files) {
        const size = f.fileSizeBytes < 1024 ? `${f.fileSizeBytes} B` : `${(f.fileSizeBytes / 1024).toFixed(1)} KB`
        md.push(`| ${f.fileName} | ${f.dataset} | ${f.zone} | ${f.checksumStatus} | ${size} | ${f.fileStatus} |`)
      }
    }
    md.push('')

    md.push('## Staging & warehouse impact')
    md.push('')
    md.push('| Feed | Valid | Rejected |')
    md.push('|---|---|---|')
    md.push(`| energy_consumption | ${fmtNum(energyValid)} | ${fmtNum(energyRejected)} |`)
    md.push(`| carbon_emissions | ${fmtNum(carbonValid)} | ${fmtNum(carbonRejected)} |`)
    md.push(`| site_master | ${fmtNum(siteMasterValid)} | ${fmtNum(siteMasterRejected)} |`)
    md.push('')
    md.push(`**Warehouse impact:** ${fmtNum(facts.length)} fact rows · ${siteSet.size} sites covered · ${fmtNum(targetEnergy, 1)} kWh loaded · ${fmtNum(targetEmissions, 1)} kg CO₂e.`)
    md.push('')

    if (rejectionReasons.length > 0) {
      md.push('### Staging rejection reasons')
      md.push('')
      for (const r of rejectionReasons) {
        md.push(`- \`${r}\``)
      }
      md.push('')
    }

    md.push('## Source → target reconciliation')
    md.push('')
    md.push('| Metric | Source (staging VALID) | Target (fact) | Δ |')
    md.push('|---|---|---|---|')
    md.push(`| Row count | ${fmtNum(sourceCount)} | ${fmtNum(targetCount)} | ${sourceCount - targetCount} |`)
    md.push(`| Energy (kWh) | ${fmtNum(sourceEnergy, 2)} | ${fmtNum(targetEnergy, 2)} | ${(sourceEnergy - targetEnergy).toFixed(2)} |`)
    md.push(`| Emissions (kg CO₂e) | ${fmtNum(sourceEmissions, 2)} | ${fmtNum(targetEmissions, 2)} | ${(sourceEmissions - targetEmissions).toFixed(2)} |`)
    md.push('')
    md.push(`**Status:** ${reconStatus}`)
    md.push('')

    md.push('## Data quality checks')
    md.push('')
    md.push(`**Summary:** ${dqChecks.length} executed · ${dqPass} passed · ${dqFail} failed · ${dqWarn} warn.`)
    md.push('')
    if (dqChecks.length === 0) {
      md.push('No DQ checks recorded for this batch.')
    } else {
      md.push('| Check | Category | Target | Expected → Actual | Severity | Status |')
      md.push('|---|---|---|---|---|---|')
      for (const c of dqChecks) {
        const target = `${c.tableName ?? '-'}${c.columnName ? '.' + c.columnName : ''}`
        const exp = c.expectedValue ?? '∅'
        const act = c.actualValue ?? '∅'
        md.push(`| ${c.checkName} | ${c.checkCategory} | ${target} | ${exp} → ${act} | ${c.severity} | ${c.status} |`)
      }
    }
    md.push('')

    md.push('## Incidents raised by this batch')
    md.push('')
    if (incidents.length === 0) {
      md.push('No incidents were raised by this batch.')
    } else {
      md.push('| Incident | Severity | Status | Type | File | Check | Runbook |')
      md.push('|---|---|---|---|---|---|---|')
      for (const i of incidents) {
        md.push(`| ${i.incidentId} | ${i.severity} | ${i.status} | ${i.incidentType.replace(/_/g, ' ')} | ${i.affectedFile ?? '-'} | ${i.affectedCheck ?? '-'} | ${i.runbookLink ?? '-'} |`)
      }
    }
    md.push('')

    if (alerts.length > 0) {
      md.push('## Alerts dispatched for this batch')
      md.push('')
      md.push('| Time | Type | Severity | Message | Channels | Ack |')
      md.push('|---|---|---|---|---|---|')
      for (const a of alerts) {
        md.push(`| ${fmtTime(a.createdAt.toISOString())} | ${a.alertType.replace(/_/g, ' ')} | ${a.severity} | ${a.message.replace(/\|/g, '\\|')} | ${a.channels} | ${a.acknowledgedFlag ? 'yes' : 'no'} |`)
      }
      md.push('')
    }

    md.push('## Reproducibility')
    md.push('')
    md.push(`\`\`\`bash`)
    md.push(`# Re-run this batch end-to-end from the Control Room, or via the API:`)
    md.push(`curl -X POST http://localhost:3000/api/pipeline/run -H 'Content-Type: application/json' -d '{"businessDate": "${batchIdToDate(batchId)}"}'`)
    md.push(`\`\`\``)
    md.push('')

    const out = md.join('\n')
    return new NextResponse(out, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="batch_lineage_${batchId}.md"`,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export batch lineage' },
      { status: 500 },
    )
  }
}
