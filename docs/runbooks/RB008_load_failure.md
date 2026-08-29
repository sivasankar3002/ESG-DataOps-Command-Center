# RB008 — Load Failure

## Incident type

LOAD_FAILURE

Raised automatically when `load_staging_task` or `load_warehouse_task` (or the batch orchestration itself) ends with status FAILED in `job_run_audit`, meaning the batch's data could not be loaded into staging and/or the warehouse.

## Severity guidance

P1 (severity mapping: LOAD_FAILURE -> P1) — highest operational priority. Auto-created by the pipeline (`notify_incident_task`); assigned to **ESG DataOps L1** with immediate alerting on the console, email stub and webhook stub channels (`logs/alert_channels.log`). Work a P1 load failure immediately and in parallel with the Data Engineering L2 escalation.

## Business impact

- The batch's data does not reach staging and/or the warehouse: `fact_energy_emissions` and/or `dim_site` miss the business date.
- All downstream steps for the batch (data-quality checks, reconciliation, daily report) are SKIPPED or incomplete; the daily ops report turns RED.
- Freshness degrades: once the newest reading is older than 26 hours, a FRESHNESS_FAILURE (RB010) follows.
- Multi-feed batches may be partially loaded — reconciliation must be re-verified after the fix.

## First-level checks

1. Control Room: confirm the batch_id and the failed run; check whether the automatic retry (pipeline retry policy: 1 retry) already ran.
2. Pipeline Runs tab: identify the failed task (`task_id`) and read `error_message`; compare `duration_seconds` against the 120-second task timeout.
3. Pipeline Runs tab: check which tasks completed SUCCESS and which are SKIPPED, to determine how far the batch progressed (partial-load assessment).
4. Incidents tab: open the LOAD_FAILURE incident (P1); note incident_id, `created_at`, and the evidence path — `error_log.txt` in the evidence package holds the error detail.
5. Data Quality tab: check whether `run_data_quality_checks_task` executed at all; SKIPPED checks explain a quiet Data Quality tab during a load failure.
6. File Ingestion tab: confirm the feeds themselves were received and validated (load failures are usually downstream of ingestion).
7. Overview tab: check the alert log entries for the failure and acknowledge the alert.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN).

```sql
-- Q1: Which tasks failed, and with what error?
SELECT task_id, job_name, status, start_time, end_time, duration_seconds,
       rows_read, rows_loaded, rows_rejected, error_message
FROM job_run_audit
WHERE batch_id = '{batch_id}'
  AND status = 'FAILED'
ORDER BY sequence;

-- Q2: How far did the batch get (full task sequence)?
SELECT task_id, status, duration_seconds, rows_loaded
FROM job_run_audit
WHERE batch_id = '{batch_id}'
ORDER BY sequence;

-- Q3: What is the state of the P1 incident?
SELECT incident_id, severity, status, short_description, error_message,
       affected_table, escalated_flag, created_at
FROM incident_log
WHERE batch_id = '{batch_id}'
  AND incident_type = 'LOAD_FAILURE';

-- Q4: Was the batch partially loaded into staging and the warehouse?
SELECT
  (SELECT COUNT(*) FROM staging_energy_data WHERE batch_id = '{batch_id}') AS staging_rows,
  (SELECT COUNT(*) FROM fact_energy_emissions WHERE batch_id = '{batch_id}') AS fact_rows;
```

## Expected normal result

- Q1: no rows — no task has status FAILED.
- Q2: all eight tasks (file_sensor_task, ingest_and_validate_file_task, load_staging_task, run_data_quality_checks_task, load_warehouse_task, reconcile_source_to_target_task, generate_ops_report_task, notify_incident_task) status SUCCESS in sequence order.
- Q3: no rows returned.
- Q4: `staging_rows` and `fact_rows` both non-zero and consistent (fact rows equal the valid staging rows).

## Possible root causes

Ranked by observed frequency:

- Transient infrastructure error (database connectivity, disk, timeout beyond the 120-second task limit) — often cleared by the automatic retry.
- Constraint violation during `load_warehouse_task`, for example a fact row referencing a `site_id` absent from `dim_site`.
- A bad record slipping through validation and aborting the warehouse load (data-type or constraint error).
- Orchestrator-level failure between tasks (job crash, environment issue).
- Cascade from an upstream defect: a quarantined feed with SKIPPED downstream tasks — verify before classifying as a true load failure.

## Resolution steps

1. Read the failed task's `error_message` (Q1) and the `error_log.txt` evidence file; classify the failure: transient, data, or configuration.
2. For a transient error: re-run the pipeline for the batch from the Control Room (one retry is automatic; further retries are manual).
3. For a constraint or referential error: identify the offending records from the error message and the evidence `failed_rows.csv`. If the data is defective, follow RB007 and request a corrected feed; if the pipeline mapping is wrong, escalate to Data Engineering L2.
4. After the re-run, verify all eight tasks are SUCCESS (Q2) and that counts are consistent (Q4).
5. Re-verify reconciliation on the Reconciliation tab; confirm the daily report regenerates (`generate_ops_report_task`) and health returns to GREEN or AMBER as appropriate.
6. Update the incident work notes at each step; resolve with root cause, fix, and verification evidence; close after monitoring the next successful batch.

## Escalation criteria

Escalate to Data Engineering L2 and the on-call manager immediately (P1 policy — do not wait) when:

- Any LOAD_FAILURE does not clear after one manual re-run.
- The failure is caused by pipeline code, configuration, or warehouse schema issues.
- Two or more LOAD_FAILURE incidents occur on the same day.

The 240-minute auto-escalation is a backstop only — a P1 must never sit unresolved that long.

## Related dashboard tab

Pipeline Runs (task-level failure evidence); supporting evidence on Incidents, Overview alerts and the Daily Report.

## Related tables

- `job_run_audit`
- `incident_log`
- `staging_energy_data` / `staging_site_master`
- `fact_energy_emissions` / `dim_site`
- `dq_check_results` (checks skipped or failed downstream)
- `alert_log`
