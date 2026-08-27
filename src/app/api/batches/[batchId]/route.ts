// =====================================================================
// ESG DataOps Command Center — Batch Explorer API (lineage drilldown)
// GET /api/batches/[batchId] — end-to-end lineage for one batch:
// DAG tasks, ingested files, staging stats, DQ checks, incidents with
// evidence, reconciliation and warehouse impact. This is the
// batch_id/run_id full-traceability view (spec § traceability).
// =====================================================================

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadConfig } from '@/lib/esg/config'
import { batchIdToDate } from '@/lib/esg/reconciliation'

export const dynamic = 'force-dynamic'

/**
 * GET /api/batches/[batchId]
 * Returns the complete lineage record for a batch so an L1 engineer can
 * answer "what happened in this run?" without touching SQL by hand.
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
      return NextResponse.json({ error: `No lineage records found for batch ${batchId}` }, { status: 404 })
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
    const status = failedTasks > 0 ? 'FAILED' : skippedTasks > 0 ? 'PARTIAL' : tasks.length > 0 ? 'SUCCESS' : 'NO_RUNS'

    // ---- staging stats (per dataset — energy + carbon feed the same
    // staging table, so split them for an honest per-feed view) --------
    const energyStaging = stagingEnergy.filter((s) => s.dataset === 'energy_consumption')
    const carbonStaging = stagingEnergy.filter((s) => s.dataset === 'carbon_emissions')
    const stagingValid = energyStaging.filter((s) => s.validationStatus === 'VALID').length
    const stagingRejected = energyStaging.filter((s) => s.validationStatus === 'REJECTED').length
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

    // ---- DQ summary ---------------------------------------------------------
    const dqSummary = {
      executed: dqChecks.length,
      passed: dqChecks.filter((c) => c.status === 'PASS').length,
      failed: dqChecks.filter((c) => c.status === 'FAIL').length,
      warn: dqChecks.filter((c) => c.status === 'WARN').length,
    }

    // ---- reconciliation (read-only recompute of the batch recon) -----------
    // Mirrors reconcileSourceToTargetTask: only VALID energy_consumption
    // staging rows are eligible for the warehouse load (carbon rows are a
    // separate feed reconciled by the cross-dataset consistency check).
    const validStaging = energyStaging.filter((s) => s.validationStatus === 'VALID')
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

    // ---- incidents + evidence ------------------------------------------------
    const incidentIds = incidents.map((i) => i.incidentId)
    const [workNotes, evidence] = await Promise.all([
      incidentIds.length > 0
        ? db.workNote.findMany({ where: { incidentId: { in: incidentIds } }, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
      incidentIds.length > 0
        ? db.incidentEvidence.findMany({ where: { incidentId: { in: incidentIds } }, orderBy: { evidenceId: 'asc' } })
        : Promise.resolve([]),
    ])

    // ---- warehouse impact ------------------------------------------------------
    const siteSet = new Set(facts.map((f) => f.siteId))

    return NextResponse.json({
      batch: {
        batchId,
        businessDate: batchIdToDate(batchId),
        dagId: tasks[0]?.dagId ?? 'esg_daily_ingestion',
        startedAt: startedAt ? startedAt.toISOString() : null,
        endedAt: endedAt ? endedAt.toISOString() : null,
        totalDurationSeconds:
          startedAt && endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10
            : Math.round(tasks.reduce((a, t) => a + (t.durationSeconds ?? 0), 0) * 10) / 10,
        status,
        taskCount: tasks.length,
        failedTasks,
        skippedTasks,
      },
      tasks: tasks.map((t) => ({
        runId: t.runId,
        taskId: t.taskId,
        jobName: t.jobName,
        jobType: t.jobType,
        sequence: t.sequence,
        startTime: t.startTime.toISOString(),
        endTime: t.endTime ? t.endTime.toISOString() : null,
        durationSeconds: t.durationSeconds,
        status: t.status,
        rowsRead: t.rowsRead,
        rowsLoaded: t.rowsLoaded,
        rowsRejected: t.rowsRejected,
        errorMessage: t.errorMessage,
      })),
      files: files.map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        dataset: f.dataset,
        zone: f.zone,
        fileStatus: f.fileStatus,
        checksumStatus: f.checksumStatus,
        checksumValue: f.checksumValue,
        fileSizeBytes: f.fileSizeBytes,
        receivedAt: f.receivedAt ? f.receivedAt.toISOString() : null,
        errorMessage: f.errorMessage,
      })),
      staging: {
        energyValid: stagingValid,
        energyRejected: stagingRejected,
        carbonValid,
        carbonRejected,
        siteMasterValid,
        siteMasterRejected,
        rejectionReasons,
      },
      dq: {
        summary: dqSummary,
        checks: dqChecks.map((c) => ({
          checkId: c.checkId,
          checkName: c.checkName,
          checkCategory: c.checkCategory,
          status: c.status,
          severity: c.severity,
          tableName: c.tableName,
          columnName: c.columnName,
          expectedValue: c.expectedValue,
          actualValue: c.actualValue,
          thresholdValue: c.thresholdValue,
          errorDetails: c.errorDetails,
        })),
      },
      incidents: incidents.map((i) => ({
        incidentId: i.incidentId,
        incidentType: i.incidentType,
        severity: i.severity,
        status: i.status,
        shortDescription: i.shortDescription,
        affectedFile: i.affectedFile,
        affectedCheck: i.affectedCheck,
        runbookLink: i.runbookLink,
        escalatedFlag: i.escalatedFlag,
        createdAt: i.createdAt.toISOString(),
        workNoteCount: workNotes.filter((w) => w.incidentId === i.incidentId).length,
        evidenceCount: evidence.filter((e) => e.incidentId === i.incidentId).length,
      })),
      reconciliation: {
        sourceCount,
        targetCount,
        diffRows: sourceCount - targetCount,
        sourceEnergy: Math.round(sourceEnergy * 100) / 100,
        targetEnergy: Math.round(targetEnergy * 100) / 100,
        energyDiff: Math.round((sourceEnergy - targetEnergy) * 100) / 100,
        sourceEmissions: Math.round(sourceEmissions * 100) / 100,
        targetEmissions: Math.round(targetEmissions * 100) / 100,
        status: reconStatus,
      },
      warehouse: {
        factRows: facts.length,
        sitesCovered: siteSet.size,
        totalEnergyKwh: Math.round(targetEnergy * 100) / 100,
        totalEmissionsCo2e: Math.round(targetEmissions * 100) / 100,
      },
      alerts: alerts.map((a) => ({
        alertId: a.alertId,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        channels: a.channels,
        acknowledgedFlag: a.acknowledgedFlag,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load batch lineage' },
      { status: 500 },
    )
  }
}
