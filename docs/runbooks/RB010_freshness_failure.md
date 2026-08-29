# RB010 — Freshness Failure

## Incident type

FRESHNESS_FAILURE

Raised automatically when `freshness_check` (category FRESHNESS, severity HIGH) fails during `run_data_quality_checks_task`: the warehouse must contain readings at least as recent as business date - 1 day (policy `freshness_hours: 26` in `config/data_quality_rules.yaml`).

## Severity guidance

P2 (severity mapping: FRESHNESS_FAILURE -> P2). Auto-created by the pipeline; assigned to **ESG DataOps L1** / **L1 On-call**. Freshness failures are frequently the visible symptom of an earlier root cause (missing, empty, quarantined or late file; or a load failure) — always check for a related incident before treating this as a standalone problem.

## Business impact

- The reporting layer serves stale ESG data: consumers see no readings for business date - 1 or newer.
- Regulatory and disclosure timelines that assume daily-current data are at risk as the gap grows.
- A failing `freshness_check` degrades the daily report health and erodes confidence in the platform's operational status.

## First-level checks

1. Control Room: confirm the current batch and health; look for an earlier incident (FILE_MISSING, EMPTY_FILE, SLA_BREACH, LOAD_FAILURE) that explains the stale data.
2. Data Quality tab: open the `freshness_check` FAIL row; note `expected_value` (maximum acceptable age) and `actual_value` (age of the newest reading).
3. Overview tab: read the freshness KPI and the 14-day trend to see when the data went stale.
4. File Ingestion tab: confirm whether today's feeds were received, and check the latest `received_at` per dataset.
5. Pipeline Runs tab: verify `load_warehouse_task` succeeded for the latest batch — a failed load is the usual upstream cause.
6. Incidents tab: list open incidents for the last two business dates; work the root-cause incident alongside this one.
7. Reconciliation tab: confirm whether the latest complete batch reconciled, so you know the last trustworthy business date.

## SQL queries to run

Placeholder substitution: `{business_date}` = business date in YYYY-MM-DD form (the date the check evaluated); `{batch_id}` = latest batch identifier (format B-YYYYMMDD-NN).

```sql
-- Q1: What is the newest reading in the warehouse, and when was it loaded?
SELECT MAX(reading_date) AS latest_reading_date, MAX(loaded_at) AS last_load_time
FROM fact_energy_emissions;

-- Q2: What did freshness_check conclude?
SELECT check_name, status, severity, expected_value, actual_value, threshold_value,
       error_details, executed_at
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'freshness_check';

-- Q3: What is the state of the FRESHNESS_FAILURE incident?
SELECT incident_id, severity, status, short_description, affected_table, escalated_flag, created_at
FROM incident_log
WHERE incident_type = 'FRESHNESS_FAILURE'
ORDER BY created_at DESC
LIMIT 5;

-- Q4: Did the latest feeds land and load (per-file status and warehouse rows)?
SELECT f.file_name, f.dataset, f.file_status, f.zone, f.received_at,
       (SELECT COUNT(*) FROM fact_energy_emissions fe
         WHERE fe.source_file_name = f.file_name) AS fact_rows
FROM file_ingestion_log f
WHERE f.batch_id = '{batch_id}'
ORDER BY f.file_name;
```

## Expected normal result

- Q1: `latest_reading_date` equals business date - 1 or newer; `last_load_time` is this morning's DAG run.
- Q2: `freshness_check` status PASS; the actual age is within 26 hours.
- Q3: no rows returned.
- Q4: all files PROCESSED with `fact_rows` > 0.

## Possible root causes

Ranked by observed frequency:

- An upstream incident already open: missing file (RB001), empty file (RB002), quarantined feed (RB003/RB004) or load failure (RB008) — freshness is the downstream symptom.
- The DAG did not run (orchestrator down or schedule missed).
- The feed arrived late but the batch was not re-run after arrival.
- Evaluation edge case: business-date rollover with no data yet for the newest date — confirm with Q1 before assuming a platform defect.

## Resolution steps

1. Identify the last good business date in the warehouse (Q1) and the first missing date — this bounds the gap.
2. Find and resolve the root-cause incident first, using the matching runbook; freshness typically recovers with the next successful load.
3. If no upstream incident exists and files were received, verify `load_warehouse_task` succeeded; if it failed, follow RB008.
4. Trigger a pipeline re-run from the Control Room for the affected batch/business date to load the missing data.
5. Confirm Q1 now shows a reading date within the 26-hour policy and `freshness_check` PASSes on the next evaluation.
6. If the gap spans multiple dates, request backfill extracts from the source system owners and load them batch by batch, verifying reconciliation after each.
7. Resolve the incident documenting the gap window, the root cause, and the recovery timestamp.

## Escalation criteria

Escalate to Data Engineering L2 if:

- The freshness gap exceeds one full business day (data missing well beyond the 26-hour policy).
- No root-cause incident explains the staleness (suspected orchestrator or platform defect).
- The gap requires multi-day backfill coordination with source owners.

Auto-escalation applies at 240 minutes unresolved for the P2 incident.

## Related dashboard tab

Overview (freshness KPI and trend); supporting evidence on Data Quality, File Ingestion, Pipeline Runs and Incidents.

## Related tables

- `fact_energy_emissions`
- `dq_check_results` (freshness_check)
- `file_ingestion_log`
- `job_run_audit`
- `incident_log`
