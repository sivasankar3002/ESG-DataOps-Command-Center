// =====================================================================
// ESG DataOps Command Center — MODULE 11: monitoring & alerting (sim)
// Every alert is persisted in alert_log and dispatched to simulated
// channels (console / email stub / webhook stub) — standing in for
// CloudWatch alarms + SNS/Slack without paid services.
// =====================================================================

import { db } from '@/lib/db'
import { loadConfig } from './config'
import { dispatchChannelStub } from './logger'
import type { AlertType } from './types'

export interface AlertInput {
  alertType: AlertType
  severity: string
  message: string
  batchId?: string | null
  runId?: string | null
  asOf?: Date
}

/** Persist + dispatch an alert across all configured channels. */
export async function dispatchAlert(input: AlertInput): Promise<void> {
  const config = loadConfig()
  const asOf = input.asOf ?? new Date()

  await db.alertLog.create({
    data: {
      createdAt: asOf,
      batchId: input.batchId ?? null,
      runId: input.runId ?? null,
      alertType: input.alertType,
      severity: input.severity,
      message: input.message,
      channels: (config.settings.alertChannels.length > 0
        ? config.settings.alertChannels
        : ['console']
      ).join(','),
    },
  })

  dispatchChannelStub(
    config.settings.alertChannels,
    input.alertType,
    input.severity,
    input.message,
  )
}

/** Acknowledge an alert (L1 on-call action). */
export async function acknowledgeAlert(alertId: number): Promise<boolean> {
  const updated = await db.alertLog.updateMany({
    where: { alertId, acknowledgedFlag: false },
    data: { acknowledgedFlag: true, acknowledgedAt: new Date() },
  })
  return updated.count > 0
}

/** Acknowledge every unacknowledged alert at once (shift-handover bulk action). */
export async function acknowledgeAllAlerts(): Promise<number> {
  const updated = await db.alertLog.updateMany({
    where: { acknowledgedFlag: false },
    data: { acknowledgedFlag: true, acknowledgedAt: new Date() },
  })
  return updated.count
}
