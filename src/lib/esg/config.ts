// =====================================================================
// ESG DataOps Command Center — YAML configuration loader
// Loads config/settings.yaml, config/file_manifest.yaml and
// config/data_quality_rules.yaml (parsed with js-yaml) with defensive
// defaults so a malformed file never crashes the pipeline.
// =====================================================================

import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import type { DqSeverity, IncidentSeverity, IncidentType } from './types'

export interface SettingsConfig {
  appName: string
  environment: string
  dataHome: string
  incomingDir: string
  quarantineDir: string
  processedDir: string
  evidenceDir: string
  logsDir: string
  reportsDir: string
  dagStart: string
  slaDefaultHours: number
  dagId: string
  retries: number
  taskTimeoutSeconds: number
  loadPolicy: string
  assignmentGroup: string
  assignedTo: string
  escalationGroup: string
  escalationThresholdMinutes: number
  severityMapping: Record<string, IncidentSeverity>
  alertChannels: string[]
  refreshSeconds: number
  trendDays: number
  rejectedThresholdPct: number
  aggregateTolerance: number
}

export interface DatasetManifest {
  name: string
  description: string
  pattern: string
  format: string
  sourceSystem: string
  expectedArrival: string // "HH:mm"
  slaHours: number
  primaryKey: string[]
  expectedRowsMin: number
  expectedRowsMax: number
  mandatory: boolean
}

export interface NumericRange {
  min?: number
  max?: number
}

export interface DatasetRules {
  requiredColumns: string[]
  primaryKey: string[]
  mandatoryNotNull: string[]
  numericRange: Record<string, NumericRange>
  dateFormat?: string
  freshnessHours?: number
  rowCountVarianceThreshold?: number
}

export interface CheckRule {
  category: string
  severity: DqSeverity
  incidentType: IncidentType | null
  createIncident: boolean
}

export interface LoadedConfig {
  settings: SettingsConfig
  manifest: Record<string, DatasetManifest>
  rules: {
    datasets: Record<string, DatasetRules>
    checks: Record<string, CheckRule>
  }
}

/** Resolve a repo-relative path; ESG_DATA_HOME overrides the data root. */
export function resolvePath(rel: string): string {
  const dataHome = process.env.ESG_DATA_HOME
  const root = process.cwd()
  if (dataHome && rel.startsWith('data/')) {
    return path.join(root, dataHome, rel.slice('data/'.length))
  }
  return path.join(root, rel)
}

function readYaml(relPath: string): Record<string, unknown> {
  const abs = path.join(process.cwd(), relPath)
  if (!fs.existsSync(abs)) return {}
  try {
    const doc = yamlLoad(fs.readFileSync(abs, 'utf-8'))
    return (doc ?? {}) as Record<string, unknown>
  } catch (err) {
    // Defensive: a broken YAML must never take the platform down.
    console.error(`[config] failed to parse ${relPath}:`, err)
    return {}
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

let cached: LoadedConfig | null = null

/** Load and cache all YAML configuration (re-read on demand in dev). */
export function loadConfig(force = false): LoadedConfig {
  if (cached && !force) return cached

  const settingsYaml = asRecord(readYaml('config/settings.yaml'))
  const pathsYaml = asRecord(settingsYaml.paths)
  const schedulesYaml = asRecord(settingsYaml.schedules)
  const slaYaml = asRecord(schedulesYaml.sla)
  const pipelineYaml = asRecord(settingsYaml.pipeline)
  const incidentsYaml = asRecord(settingsYaml.incidents)
  const dashboardYaml = asRecord(settingsYaml.dashboard)
  const reportingYaml = asRecord(settingsYaml.reporting)
  const alertsYaml = asRecord(settingsYaml.alerts)

  const severityMapping: Record<string, IncidentSeverity> = {}
  const rawMapping = asRecord(incidentsYaml.severity_mapping)
  for (const [k, v] of Object.entries(rawMapping)) {
    if (typeof v === 'string') severityMapping[k] = v as IncidentSeverity
  }

  const settings: SettingsConfig = {
    appName: (settingsYaml.app as Record<string, unknown>)?.name as string ?? 'ESG DataOps Command Center',
    environment: (settingsYaml.app as Record<string, unknown>)?.environment as string ?? 'LOCAL-SIM',
    dataHome: 'data',
    incomingDir: (pathsYaml.incoming_dir as string) ?? 'data/incoming',
    quarantineDir: (pathsYaml.quarantine_dir as string) ?? 'data/quarantine',
    processedDir: (pathsYaml.processed_dir as string) ?? 'data/processed',
    evidenceDir: (pathsYaml.evidence_dir as string) ?? 'evidence',
    logsDir: (pathsYaml.logs_dir as string) ?? 'logs',
    reportsDir: (pathsYaml.reports_dir as string) ?? 'reports',
    dagStart: (schedulesYaml.dag_start as string) ?? '06:30',
    slaDefaultHours: (slaYaml.default_hours as number) ?? 4,
    dagId: (pipelineYaml.dag_id as string) ?? 'esg_daily_ingestion',
    retries: (pipelineYaml.retries as number) ?? 1,
    taskTimeoutSeconds: (pipelineYaml.task_timeout_seconds as number) ?? 120,
    loadPolicy: (pipelineYaml.load_policy as string) ?? 'validated_records_only',
    assignmentGroup: (incidentsYaml.assignment_group as string) ?? 'ESG DataOps L1',
    assignedTo: (incidentsYaml.assigned_to as string) ?? 'L1 On-call',
    escalationGroup: (incidentsYaml.escalation_group as string) ?? 'Data Engineering L2',
    escalationThresholdMinutes: (incidentsYaml.escalation_threshold_minutes as number) ?? 240,
    severityMapping,
    alertChannels: asArray(alertsYaml.channels).filter((c): c is string => typeof c === 'string'),
    refreshSeconds: (dashboardYaml.refresh_seconds as number) ?? 30,
    trendDays: (dashboardYaml.trend_days as number) ?? 14,
    rejectedThresholdPct: (reportingYaml.rejected_record_threshold_pct as number) ?? 5,
    aggregateTolerance: (reportingYaml.aggregate_tolerance as number) ?? 0.01,
  }

  // ----- file manifest -------------------------------------------------
  const manifestYaml = asRecord(readYaml('config/file_manifest.yaml'))
  const manifest: Record<string, DatasetManifest> = {}
  for (const [name, raw] of Object.entries(asRecord(manifestYaml.datasets))) {
    const d = asRecord(raw)
    manifest[name] = {
      name,
      description: (d.description as string) ?? '',
      pattern: (d.pattern as string) ?? `${name}_{date}.csv`,
      format: (d.format as string) ?? 'csv',
      sourceSystem: (d.source_system as string) ?? 'UNKNOWN',
      expectedArrival: (d.expected_arrival as string) ?? '06:30',
      slaHours: (d.sla_hours as number) ?? settings.slaDefaultHours,
      primaryKey: asArray(d.primary_key).filter((k): k is string => typeof k === 'string'),
      expectedRowsMin: (d.expected_rows_min as number) ?? 0,
      expectedRowsMax: (d.expected_rows_max as number) ?? 100000,
      mandatory: (d.mandatory as boolean) ?? true,
    }
  }

  // ----- data quality rules ---------------------------------------------
  const dqYaml = asRecord(readYaml('config/data_quality_rules.yaml'))
  const datasets: Record<string, DatasetRules> = {}
  for (const [name, raw] of Object.entries(asRecord(dqYaml.datasets))) {
    const d = asRecord(raw)
    const numericRange: Record<string, NumericRange> = {}
    for (const [col, r] of Object.entries(asRecord(d.numeric_range))) {
      const rr = asRecord(r)
      numericRange[col] = {
        min: typeof rr.min === 'number' ? rr.min : undefined,
        max: typeof rr.max === 'number' ? rr.max : undefined,
      }
    }
    datasets[name] = {
      requiredColumns: asArray(d.required_columns).filter((c): c is string => typeof c === 'string'),
      primaryKey: asArray(d.primary_key).filter((c): c is string => typeof c === 'string'),
      mandatoryNotNull: asArray(d.mandatory_not_null).filter((c): c is string => typeof c === 'string'),
      numericRange,
      dateFormat: d.date_format as string | undefined,
      freshnessHours: d.freshness_hours as number | undefined,
      rowCountVarianceThreshold: (d.row_count_variance_threshold as number) ?? 0,
    }
  }

  const checks: Record<string, CheckRule> = {}
  for (const [name, raw] of Object.entries(asRecord(dqYaml.checks))) {
    const c = asRecord(raw)
    checks[name] = {
      category: (c.category as string) ?? 'OPERATIONS',
      severity: (c.severity as DqSeverity) ?? 'MEDIUM',
      incidentType: (c.incident_type as IncidentType | null) ?? null,
      createIncident: (c.create_incident as boolean) ?? false,
    }
  }

  cached = { settings, manifest, rules: { datasets, checks } }
  return cached
}

/** Build the regex a file name must match for a dataset + date. */
export function datasetFileRegex(dataset: DatasetManifest, businessDate: string): RegExp {
  const literal = dataset.pattern
    .replace('{date}', businessDate)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${literal}$`)
}

/** Build a regex matching the pattern for ANY date (naming validation). */
export function datasetAnyDateRegex(dataset: DatasetManifest): RegExp {
  const escaped = dataset.pattern
    .split('{date}')
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\d{4}-\\d{2}-\\d{2}')
  return new RegExp(`^${escaped}$`)
}

/** Expected arrival Date for a dataset on a business date (local time). */
export function expectedArrivalDate(dataset: DatasetManifest, businessDate: string): Date {
  const [h, m] = dataset.expectedArrival.split(':').map((x) => parseInt(x, 10))
  const d = new Date(`${businessDate}T00:00:00`)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}
