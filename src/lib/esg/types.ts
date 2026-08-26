// =====================================================================
// ESG DataOps Command Center — shared domain types & enums
// Enums mirror the reference PostgreSQL DDL CHECK constraints.
// =====================================================================

// ----- File ingestion ------------------------------------------------
export const FILE_STATUSES = [
  'RECEIVED',
  'VALIDATING',
  'VALIDATED',
  'QUARANTINED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

export const CHECKSUM_STATUSES = ['PENDING', 'VALID', 'INVALID', 'SKIPPED'] as const
export type ChecksumStatus = (typeof CHECKSUM_STATUSES)[number]

export const ZONES = ['INCOMING', 'QUARANTINE', 'PROCESSED'] as const
export type Zone = (typeof ZONES)[number]

// ----- Job runs -------------------------------------------------------
export const JOB_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

// ----- Data quality ---------------------------------------------------
export const CHECK_STATUSES = ['PASS', 'FAIL', 'WARN'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

export const DQ_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type DqSeverity = (typeof DQ_SEVERITIES)[number]

export const CHECK_CATEGORIES = [
  'COMPLETENESS',
  'SCHEMA',
  'INTEGRITY',
  'UNIQUENESS',
  'VALIDITY',
  'FRESHNESS',
  'RECONCILIATION',
  'OPERATIONS',
] as const
export type CheckCategory = (typeof CHECK_CATEGORIES)[number]

// ----- Incidents ------------------------------------------------------
export const INCIDENT_TYPES = [
  'FILE_MISSING',
  'FILE_CORRUPTED',
  'SCHEMA_DRIFT',
  'EMPTY_FILE',
  'CHECKSUM_MISMATCH',
  'DUPLICATE_RECORDS',
  'NULL_VALUES',
  'RANGE_VIOLATION',
  'ROW_COUNT_MISMATCH',
  'LOAD_FAILURE',
  'SLA_BREACH',
  'FRESHNESS_FAILURE',
] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

export const INCIDENT_SEVERITIES = ['P1', 'P2', 'P3', 'P4'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

export const INCIDENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

// ServiceNow-style lifecycle transitions
export const INCIDENT_TRANSITIONS: Record<string, IncidentStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
}

// ----- Evidence -------------------------------------------------------
export const EVIDENCE_TYPES = [
  'LOG_FILE',
  'FAILED_ROWS_CSV',
  'QUERY_RESULT_JSON',
  'SCREENSHOT_PLACEHOLDER',
  'INCIDENT_SUMMARY_JSON',
  'ESCALATION_HANDOFF_MD',
] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

// ----- Alerts ---------------------------------------------------------
export const ALERT_TYPES = [
  'FILE_MISSING',
  'CHECKSUM_MISMATCH',
  'SCHEMA_DRIFT',
  'LOAD_FAILURE',
  'SLA_BREACH',
  'FRESHNESS_FAILURE',
  'RECONCILIATION_MISMATCH',
  'EMPTY_FILE',
  'NULL_VALUES',
  'DUPLICATE_RECORDS',
  'RANGE_VIOLATION',
  'ROW_COUNT_MISMATCH',
  'INCIDENT_ESCALATED',
  'PIPELINE_COMPLETED',
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

// ----- Synthetic data scenarios ----------------------------------------
export const SCENARIOS = [
  'good',
  'missing_file',
  'empty_file',
  'missing_column',
  'duplicates',
  'null_values',
  'negative_energy',
  'bad_checksum',
  'bad_date',
  'row_count_mismatch',
  'sla_breach',
  'load_failure',
] as const
export type Scenario = (typeof SCENARIOS)[number]

export const SCENARIO_LABELS: Record<Scenario, string> = {
  good: 'Good file (baseline)',
  missing_file: 'Missing file (feed does not arrive)',
  empty_file: 'Empty file (header only)',
  missing_column: 'Schema drift (missing column)',
  duplicates: 'Duplicate record_id',
  null_values: 'Null site_id',
  negative_energy: 'Negative energy_kwh',
  bad_checksum: 'Checksum mismatch',
  bad_date: 'Invalid date format',
  row_count_mismatch: 'Row count mismatch vs manifest',
  sla_breach: 'Late file (SLA breach)',
  load_failure: 'Load failure (corrupt row)',
}

// ----- Runbooks --------------------------------------------------------
// Incident type -> runbook document (docs/runbooks/)
export const RUNBOOK_MAP: Record<IncidentType, string> = {
  FILE_MISSING: 'RB001',
  EMPTY_FILE: 'RB002',
  CHECKSUM_MISMATCH: 'RB003',
  FILE_CORRUPTED: 'RB003',
  SCHEMA_DRIFT: 'RB004',
  ROW_COUNT_MISMATCH: 'RB005',
  DUPLICATE_RECORDS: 'RB006',
  NULL_VALUES: 'RB007',
  RANGE_VIOLATION: 'RB007',
  LOAD_FAILURE: 'RB008',
  SLA_BREACH: 'RB009',
  FRESHNESS_FAILURE: 'RB010',
}

export const RUNBOOK_TITLES: Record<string, string> = {
  RB001: 'Missing File',
  RB002: 'Empty File',
  RB003: 'Checksum Mismatch / Corrupted File',
  RB004: 'Schema Drift',
  RB005: 'Row Count Mismatch',
  RB006: 'Duplicate Records',
  RB007: 'Null / Invalid Values',
  RB008: 'Load Failure',
  RB009: 'SLA Breach / Late File',
  RB010: 'Freshness Failure',
}

// ----- Health ----------------------------------------------------------
export const HEALTH_STATUSES = ['GREEN', 'AMBER', 'RED', 'NO_DATA'] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]

// ----- DQ check descriptions ------------------------------------------
// Human-readable explanations of what each YAML-configured check actually
// validates — surfaced in the DQ check detail drawer so an L1 engineer can
// triage a failure without opening config/data_quality_rules.yaml.
export const CHECK_DESCRIPTIONS: Record<string, string> = {
  file_arrival_check:
    'Verifies every feed declared mandatory in config/file_manifest.yaml has a corresponding entry in file_ingestion_log for the business date (the file_sensor_task step of the DAG).',
  empty_file_check:
    'Rejects any landing-zone file with zero payload rows — the sensor treats an empty file as a completeness failure and routes it to data/quarantine/.',
  checksum_validation:
    'Recomputes the SHA256 of every received file and compares against the manifest sidecar (.manifest.json). A mismatch raises a CHECKSUM_MISMATCH incident and quarantines the file.',
  schema_header_validation:
    'Compares the file header row against the required_columns list for the dataset (config/data_quality_rules.yaml → datasets.<name>.required_columns). Missing/extra columns raise SCHEMA_DRIFT.',
  row_count_check:
    'Compares staging row count against the variance threshold (datasets.<name>.row_count_variance_threshold). A drift beyond the threshold raises ROW_COUNT_MISMATCH.',
  sla_check:
    'Checks each expected feed arrived by its SLA time (config/file_manifest.yaml → sla_hours). A late feed raises SLA_BREACH.',
  null_check_mandatory:
    'Asserts every column in datasets.<name>.mandatory_not_null contains no NULLs in staging. Failures raise NULL_VALUES (or RANGE_VIOLATION when the column is numeric).',
  duplicate_record_check:
    'Detects duplicate primary-key tuples (datasets.<name>.primary_key) in staging. Duplicates raise DUPLICATE_RECORDS and are routed to quarantine before the warehouse load.',
  date_validity_check:
    'Validates that reading_date values match the dataset date_format (YYYY-MM-DD) and fall within the business-date window.',
  numeric_range_check:
    'Asserts numeric columns honour their min/max bounds (datasets.<name>.numeric_range). Negative energy_kwh or emissions_co2e raises RANGE_VIOLATION.',
  referential_integrity_check:
    'Joins staging energy/carbon rows against dim_site to ensure every site_id resolves to a known warehouse site. Unresolved site_ids are quarantined.',
  freshness_check:
    'Asserts the warehouse has at least one fact row for the most recent business date within freshness_hours (26h default). A gap raises FRESHNESS_FAILURE.',
  quarantined_file_check:
    'Surfaces any file routed to data/quarantine/ during this batch so the operator sees the full rejection set in one place.',
  rejected_threshold_check:
    'Asserts the percentage of rows rejected during validation is below the configured threshold (config/settings.yaml → validation.rejected_threshold_pct, default 5%). A spike indicates a systemic upstream issue.',
  source_to_target_rowcount_recon:
    'Reconciles the row count of valid staging energy_consumption rows against the fact rows loaded for the batch (delta must be 0). The core source→target completeness gate.',
  source_to_target_aggregate_recon:
    'Reconciles the SUM(energy_kwh) and SUM(emissions_co2e) between staging and the warehouse facts (tolerance = settings.yaml → reconciliation.aggregate_tolerance, default 0.01). Catches silent load losses.',
  cross_dataset_emissions_consistency:
    'Cross-checks that carbon_emissions and energy_consumption agree on total emissions_co2e for the batch (a referential guard between the two emissions feeds).',
}
