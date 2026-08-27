// =====================================================================
// ESG DataOps Command Center — Batch Comparison API
// GET /api/batches/compare?left=<id>&right=<id>
// Returns a side-by-side diff of two batches: DQ checks (added / removed
// / changed), reconciliation, warehouse impact, incidents. Lets an L1
// engineer answer "what changed between these two runs of the same
// pipeline?" without writing SQL by hand.
// =====================================================================

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadConfig } from '@/lib/esg/config'
import { batchIdToDate } from '@/lib/esg/reconciliation'

export const dynamic = 'force-dynamic'

interface DqRow {
  checkId: number
  checkName: string
  checkCategory: string
  status: string
  severity: string
  tableName: string | null
  columnName: string | null
  expectedValue: string | null
  actualValue: string | null
}

interface IncidentRow {
  incidentId: string
  severity: string
  incidentType: string
  status: string
}

interface BatchSide {
  batchId: string
  businessDate: string
  status: string
  startedAt: string | null
  totalDurationSeconds: number
  dqSummary: { executed: number; passed: number; failed: number; warn: number }
  incidents: IncidentRow[]
  reconciliation: {
    sourceCount: number
    targetCount: number
    diffRows: number
    sourceEnergy: number
    targetEnergy: number
    energyDiff: number
    status: string
  }
  warehouse: {
    factRows: number
    sitesCovered: number
    totalEnergyKwh: number
    totalEmissionsCo2e: number
  }
}

async function buildSide(batchId: string): Promise<BatchSide | null> {
  const config = loadConfig()
  const [tasks, dqChecks, incidents, facts, stagingEnergy] = await Promise.all([
    db.jobRunAudit.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } }),
    db.dqCheckResult.findMany({ where: { batchId }, orderBy: { checkId: 'asc' } }),
    db.incidentLog.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } }),
    db.factEnergyEmissions.findMany({
      where: { batchId },
      select: { energyKwh: true, emissionsCo2e: true, siteId: true },
    }),
    db.stagingEnergyData.findMany({
      where: { batchId },
      select: { validationStatus: true, dataset: true, energyKwh: true, emissionsCo2e: true },
    }),
  ])

  if (tasks.length === 0 && dqChecks.length === 0 && incidents.length === 0) {
    return null
  }

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
  const status = failedTasks > 0 ? 'FAILED' : skippedTasks > 0 ? 'PARTIAL' : 'SUCCESS'

  const dqSummary = {
    executed: dqChecks.length,
    passed: dqChecks.filter((c) => c.status === 'PASS').length,
    failed: dqChecks.filter((c) => c.status === 'FAIL').length,
    warn: dqChecks.filter((c) => c.status === 'WARN').length,
  }

  const validStaging = stagingEnergy.filter(
    (s) => s.dataset === 'energy_consumption' && s.validationStatus === 'VALID',
  )
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

  const siteSet = new Set(facts.map((f) => f.siteId))

  return {
    batchId,
    businessDate: batchIdToDate(batchId),
    status,
    startedAt: startedAt ? startedAt.toISOString() : null,
    totalDurationSeconds:
      startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10
        : Math.round(tasks.reduce((a, t) => a + (t.durationSeconds ?? 0), 0) * 10) / 10,
    dqSummary,
    incidents: incidents.map((i) => ({
      incidentId: i.incidentId,
      severity: i.severity,
      incidentType: i.incidentType,
      status: i.status,
    })),
    reconciliation: {
      sourceCount,
      targetCount,
      diffRows: sourceCount - targetCount,
      sourceEnergy: Math.round(sourceEnergy * 100) / 100,
      targetEnergy: Math.round(targetEnergy * 100) / 100,
      energyDiff: Math.round((sourceEnergy - targetEnergy) * 100) / 100,
      status: reconStatus,
    },
    warehouse: {
      factRows: facts.length,
      sitesCovered: siteSet.size,
      totalEnergyKwh: Math.round(targetEnergy * 100) / 100,
      totalEmissionsCo2e: Math.round(targetEmissions * 100) / 100,
    },
  }
}

function checkKey(c: DqRow): string {
  return `${c.checkName}@${c.tableName ?? ''}.${c.columnName ?? ''}`
}

function diffDqChecks(leftChecks: DqRow[], rightChecks: DqRow[]): BatchComparePayload['checks'] {
  const leftMap = new Map(leftChecks.map((c) => [checkKey(c), c]))
  const rightMap = new Map(rightChecks.map((c) => [checkKey(c), c]))
  const allKeys = new Set<string>([...leftMap.keys(), ...rightMap.keys()])

  const rows: BatchComparePayload['checks'] = []
  for (const key of allKeys) {
    const l = leftMap.get(key)
    const r = rightMap.get(key)
    const severity = (l ?? r)?.severity ?? 'INFO'
    const ref = l ?? r
    const target = ref ? `${ref.tableName ?? '-'}${ref.columnName ? '.' + ref.columnName : ''}` : '-'

    let diff: 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME'
    if (!l && r) diff = 'ADDED'
    else if (l && !r) diff = 'REMOVED'
    else if (l && r && l.status !== r.status) diff = 'CHANGED'
    else diff = 'SAME'

    rows.push({
      checkName: ref?.checkName ?? key,
      checkCategory: ref?.checkCategory ?? '-',
      target,
      leftStatus: l?.status ?? null,
      rightStatus: r?.status ?? null,
      leftExpected: l?.expectedValue ?? null,
      rightExpected: r?.expectedValue ?? null,
      leftActual: l?.actualValue ?? null,
      rightActual: r?.actualValue ?? null,
      severity,
      diff,
    })
  }
  // Sort: diffs first (changed > added > removed), then alphabetically
  const order = { CHANGED: 0, ADDED: 1, REMOVED: 2, SAME: 3 } as const
  rows.sort((a, b) => order[a.diff] - order[b.diff] || a.checkName.localeCompare(b.checkName))
  return rows
}

interface BatchComparePayload {
  left: BatchSide
  right: BatchSide
  checks: {
    checkName: string
    checkCategory: string
    target: string
    leftStatus: string | null
    rightStatus: string | null
    leftExpected: string | null
    rightExpected: string | null
    leftActual: string | null
    rightActual: string | null
    severity: string
    diff: 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME'
  }[]
}

/**
 * GET /api/batches/compare?left=B-...&right=B-...
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const left = url.searchParams.get('left')
    const right = url.searchParams.get('right')

    if (!left || !right) {
      return NextResponse.json({ error: 'Both ?left= and ?right= batch ids are required.' }, { status: 400 })
    }
    if (left === right) {
      return NextResponse.json({ error: 'Pick two different batch ids to compare.' }, { status: 400 })
    }

    const [leftSide, rightSide] = await Promise.all([buildSide(left), buildSide(right)])
    if (!leftSide) {
      return NextResponse.json({ error: `No lineage records found for batch ${left}` }, { status: 404 })
    }
    if (!rightSide) {
      return NextResponse.json({ error: `No lineage records found for batch ${right}` }, { status: 404 })
    }

    // Fetch DQ checks separately (already queried inside buildSide but
    // we need them as DqRow shapes for the diff).
    const [leftChecksRaw, rightChecksRaw] = await Promise.all([
      db.dqCheckResult.findMany({ where: { batchId: left }, orderBy: { checkId: 'asc' } }),
      db.dqCheckResult.findMany({ where: { batchId: right }, orderBy: { checkId: 'asc' } }),
    ])
    const leftChecks: DqRow[] = leftChecksRaw.map((c) => ({
      checkId: c.checkId,
      checkName: c.checkName,
      checkCategory: c.checkCategory,
      status: c.status,
      severity: c.severity,
      tableName: c.tableName,
      columnName: c.columnName,
      expectedValue: c.expectedValue,
      actualValue: c.actualValue,
    }))
    const rightChecks: DqRow[] = rightChecksRaw.map((c) => ({
      checkId: c.checkId,
      checkName: c.checkName,
      checkCategory: c.checkCategory,
      status: c.status,
      severity: c.severity,
      tableName: c.tableName,
      columnName: c.columnName,
      expectedValue: c.expectedValue,
      actualValue: c.actualValue,
    }))
    const checks = diffDqChecks(leftChecks, rightChecks)

    const payload: BatchComparePayload = {
      left: leftSide,
      right: rightSide,
      checks,
    }
    return NextResponse.json(payload)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to compare batches' },
      { status: 500 },
    )
  }
}
