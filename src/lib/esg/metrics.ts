/**
 * =====================================================================
 * ESG DataOps Command Center — Monitoring & Metrics System
 * =====================================================================
 *
 * Real observability layer providing:
 * - Prometheus-style metrics collection (counters, gauges, histograms)
 * - JSON metrics export for analysis
 * - Performance tracking and SLA monitoring
 * - Data quality KPI dashboards
 *
 * Metrics are persisted to:
 * - logs/metrics_YYYY-MM-DD.jsonl (newline-delimited JSON)
 * - logs/sla_tracking.json (SLA violations and trends)
 */

import fs from 'fs'
import path from 'path'
import { resolvePath } from './config'
import { fmtTimestamp } from './logger'

export interface MetricPoint {
  timestamp: Date
  name: string
  value: number
  labels: Record<string, string>
  unit: string
}

export interface SLAViolation {
  timestamp: Date
  component: string
  metric: string
  expectedValue: number
  actualValue: number
  tolerance: number
  severity: 'WARNING' | 'CRITICAL'
}

export interface DataQualityMetric {
  timestamp: Date
  dataset: string
  batchId: string
  totalRecords: number
  validRecords: number
  rejectedRecords: number
  qualityScore: number // 0-100
  topIssues: Array<{ issue: string; count: number }>
}

export interface PerformanceMetric {
  timestamp: Date
  taskName: string
  batchId: string
  runId: string
  durationMs: number
  recordsProcessed: number
  throughputRecordsPerSecond: number
  status: 'SUCCESS' | 'FAILED'
}

class MetricsCollector {
  private metrics: MetricPoint[] = []
  private slaViolations: SLAViolation[] = []
  private dataQualityMetrics: DataQualityMetric[] = []
  private performanceMetrics: PerformanceMetric[] = []

  /**
   * Record a Prometheus-style metric
   *
   * @example
   * collector.recordMetric('file_ingestion_duration_seconds', 12.5, { dataset: 'energy_consumption', status: 'success' });
   */
  recordMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    unit: string = 'count'
  ): void {
    this.metrics.push({
      timestamp: new Date(),
      name,
      value,
      labels,
      unit,
    })
  }

  /**
   * Record a data quality metric (key metric for data engineers)
   *
   * @example
   * collector.recordDataQuality({
   *   timestamp: new Date(),
   *   dataset: 'energy_consumption',
   *   batchId: 'BAT-20260830-001',
   *   totalRecords: 10000,
   *   validRecords: 9950,
   *   rejectedRecords: 50,
   *   qualityScore: 99.5,
   *   topIssues: [{ issue: 'NULL_VALUES', count: 30 }, { issue: 'OUT_OF_RANGE', count: 20 }]
   * });
   */
  recordDataQuality(metric: DataQualityMetric): void {
    this.dataQualityMetrics.push(metric)

    // Auto-check SLA: quality score < 95% is a violation
    if (metric.qualityScore < 95) {
      this.recordSLAViolation({
        timestamp: metric.timestamp,
        component: 'data_quality',
        metric: `${metric.dataset}_quality_score`,
        expectedValue: 95,
        actualValue: metric.qualityScore,
        tolerance: 5,
        severity: metric.qualityScore < 90 ? 'CRITICAL' : 'WARNING',
      })
    }
  }

  /**
   * Record task performance metrics (throughput, latency)
   *
   * @example
   * collector.recordPerformance({
   *   timestamp: new Date(),
   *   taskName: 'load_staging_task',
   *   batchId: 'BAT-20260830-001',
   *   runId: 'RUN-001',
   *   durationMs: 5000,
   *   recordsProcessed: 10000,
   *   throughputRecordsPerSecond: 2000,
   *   status: 'SUCCESS'
   * });
   */
  recordPerformance(metric: PerformanceMetric): void {
    this.performanceMetrics.push(metric)

    // Auto-check SLA: duration > expected threshold is a violation
    const expectedDurationMs = 10000 // 10 seconds
    if (metric.durationMs > expectedDurationMs) {
      this.recordSLAViolation({
        timestamp: metric.timestamp,
        component: 'performance',
        metric: `${metric.taskName}_duration_ms`,
        expectedValue: expectedDurationMs,
        actualValue: metric.durationMs,
        tolerance: 2000,
        severity: metric.durationMs > expectedDurationMs * 1.5 ? 'CRITICAL' : 'WARNING',
      })
    }
  }

  /**
   * Record an SLA violation
   */
  recordSLAViolation(violation: SLAViolation): void {
    this.slaViolations.push(violation)
    console.warn(
      `[SLA] ${violation.severity}: ${violation.component}.${violation.metric} = ${violation.actualValue} (expected: ${violation.expectedValue})`
    )
  }

  /**
   * Export metrics to JSONL for analysis/BI tools
   * Each line is a JSON object (parseable by tools like Splunk, LogStash, etc.)
   */
  exportMetricsToJSONL(): void {
    try {
      const logsDir = resolvePath('logs')
      fs.mkdirSync(logsDir, { recursive: true })

      const now = new Date()
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const metricsFile = path.join(logsDir, `metrics_${day}.jsonl`)

      // Write generic metrics
      for (const metric of this.metrics) {
        const line = JSON.stringify({
          timestamp: metric.timestamp.toISOString(),
          name: metric.name,
          value: metric.value,
          unit: metric.unit,
          labels: metric.labels,
        })
        fs.appendFileSync(metricsFile, line + '\n')
      }

      // Write data quality metrics
      for (const dq of this.dataQualityMetrics) {
        const line = JSON.stringify({
          timestamp: dq.timestamp.toISOString(),
          type: 'data_quality',
          dataset: dq.dataset,
          batchId: dq.batchId,
          totalRecords: dq.totalRecords,
          validRecords: dq.validRecords,
          rejectedRecords: dq.rejectedRecords,
          qualityScore: dq.qualityScore,
          topIssues: dq.topIssues,
        })
        fs.appendFileSync(metricsFile, line + '\n')
      }

      // Write performance metrics
      for (const perf of this.performanceMetrics) {
        const line = JSON.stringify({
          timestamp: perf.timestamp.toISOString(),
          type: 'performance',
          taskName: perf.taskName,
          batchId: perf.batchId,
          runId: perf.runId,
          durationMs: perf.durationMs,
          recordsProcessed: perf.recordsProcessed,
          throughputRecordsPerSecond: perf.throughputRecordsPerSecond,
          status: perf.status,
        })
        fs.appendFileSync(metricsFile, line + '\n')
      }

      console.log(`[Metrics] Exported to: ${metricsFile}`)
    } catch (err) {
      console.error('[Metrics] Export failed:', err)
    }
  }

  /**
   * Export SLA tracking report
   */
  exportSLAReport(): void {
    try {
      const logsDir = resolvePath('logs')
      fs.mkdirSync(logsDir, { recursive: true })

      const report = {
        exportedAt: new Date().toISOString(),
        totalViolations: this.slaViolations.length,
        criticalViolations: this.slaViolations.filter((v) => v.severity === 'CRITICAL').length,
        warningViolations: this.slaViolations.filter((v) => v.severity === 'WARNING').length,
        byComponent: this.groupByComponent(),
        violations: this.slaViolations,
      }

      const slaFile = path.join(logsDir, 'sla_tracking.json')
      fs.writeFileSync(slaFile, JSON.stringify(report, null, 2))
      console.log(`[SLA] Report exported to: ${slaFile}`)
    } catch (err) {
      console.error('[SLA] Export failed:', err)
    }
  }

  /**
   * Get data quality trend
   */
  getDataQualityTrend(datasetFilter?: string): DataQualityMetric[] {
    return datasetFilter
      ? this.dataQualityMetrics.filter((m) => m.dataset === datasetFilter)
      : this.dataQualityMetrics
  }

  /**
   * Get performance summary by task
   */
  getPerformanceSummary(
    taskFilter?: string
  ): {
    task: string
    count: number
    avgDurationMs: number
    avgThroughput: number
    successRate: number
  }[] {
    const metrics = taskFilter
      ? this.performanceMetrics.filter((m) => m.taskName === taskFilter)
      : this.performanceMetrics

    const grouped: Record<
      string,
      {
        count: number
        totalDuration: number
        totalThroughput: number
        successCount: number
      }
    > = {}

    for (const m of metrics) {
      if (!grouped[m.taskName]) {
        grouped[m.taskName] = { count: 0, totalDuration: 0, totalThroughput: 0, successCount: 0 }
      }
      grouped[m.taskName].count++
      grouped[m.taskName].totalDuration += m.durationMs
      grouped[m.taskName].totalThroughput += m.throughputRecordsPerSecond
      if (m.status === 'SUCCESS') grouped[m.taskName].successCount++
    }

    return Object.entries(grouped).map(([task, stats]) => ({
      task,
      count: stats.count,
      avgDurationMs: Math.round(stats.totalDuration / stats.count),
      avgThroughput: Math.round(stats.totalThroughput / stats.count),
      successRate: Math.round((stats.successCount / stats.count) * 100),
    }))
  }

  /**
   * Group SLA violations by component
   */
  private groupByComponent(): Record<string, number> {
    const grouped: Record<string, number> = {}
    for (const v of this.slaViolations) {
      grouped[v.component] = (grouped[v.component] || 0) + 1
    }
    return grouped
  }

  /**
   * Clear all metrics (e.g., for new batch)
   */
  clear(): void {
    this.metrics = []
    this.slaViolations = []
    this.dataQualityMetrics = []
    this.performanceMetrics = []
  }
}

// Singleton instance
let instance: MetricsCollector | null = null

export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    instance = new MetricsCollector()
  }
  return instance
}

export default {
  getMetricsCollector,
}
