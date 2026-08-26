// =====================================================================
// ESG DataOps Command Center — structured run logger
// Format: timestamp | LEVEL | module | batch_id | run_id | message
// Files: logs/app_YYYY-MM-DD.log (and logs/alert_channels.log for stubs)
// The in-memory buffer is attached to incident evidence packages.
// =====================================================================

import fs from 'fs'
import path from 'path'
import { resolvePath } from './config'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogLine {
  ts: Date
  level: LogLevel
  module: string
  batchId: string
  runId: string
  message: string
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function fmtTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function fmtLogLine(line: LogLine): string {
  return (
    `${fmtTimestamp(line.ts)} | ${line.level} | ${line.module} | ` +
    `${line.batchId} | ${line.runId} | ${line.message}`
  )
}

export class RunLogger {
  private lines: LogLine[] = []
  readonly batchId: string
  private runId: string

  constructor(batchId: string, runId = '-') {
    this.batchId = batchId
    this.runId = runId
  }

  /** Set the current task run id (used in every subsequent line). */
  setRunId(runId: string): void {
    this.runId = runId
  }

  log(level: LogLevel, module: string, message: string): void {
    const line: LogLine = { ts: new Date(), level, module, batchId: this.batchId, runId: this.runId, message }
    this.lines.push(line)
    this.persist(fmtLogLine(line))
  }

  info(module: string, message: string): void {
    this.log('INFO', module, message)
  }

  warn(module: string, message: string): void {
    this.log('WARN', module, message)
  }

  error(module: string, message: string): void {
    this.log('ERROR', module, message)
  }

  debug(module: string, message: string): void {
    this.log('DEBUG', module, message)
  }

  private persist(line: string): void {
    try {
      const logsDir = resolvePath('logs')
      fs.mkdirSync(logsDir, { recursive: true })
      const day = line.slice(0, 10)
      fs.appendFileSync(path.join(logsDir, `app_${day}.log`), line + '\n')
    } catch (err) {
      // Logging must never break the pipeline.
      console.error('[logger] failed to persist log line:', err)
    }
  }

  /** Full buffer rendered as text (used for evidence error_log.txt). */
  render(): string {
    return this.lines.map(fmtLogLine).join('\n')
  }

  /** Raw lines (used for evidence query_results / summaries). */
  buffer(): LogLine[] {
    return [...this.lines]
  }
}

/**
 * Simulated alerting channels (console / email stub / webhook stub).
 * Writes to logs/alert_channels.log — stands in for SNS/Slack/CloudWatch
 * alarms without requiring any paid external service.
 */
export function dispatchChannelStub(
  channels: string[],
  alertType: string,
  severity: string,
  message: string,
): void {
  const enabled = channels.length > 0 ? channels : ['console']
  try {
    const logsDir = resolvePath('logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const stamp = fmtTimestamp(new Date())
    const parts: string[] = []
    for (const ch of enabled) {
      if (ch === 'console') {
        console.log(`[ALERT:${severity}] ${alertType} :: ${message}`)
        parts.push('console')
      } else if (ch === 'email_stub') {
        parts.push('email_stub')
      } else if (ch === 'webhook_stub') {
        parts.push('webhook_stub')
      }
    }
    const line =
      `${stamp} | channels=${parts.join(',')} | type=${alertType} | ` +
      `severity=${severity} | ${message}`
    fs.appendFileSync(path.join(logsDir, 'alert_channels.log'), line + '\n')
  } catch (err) {
    console.error('[logger] channel stub dispatch failed:', err)
  }
}
