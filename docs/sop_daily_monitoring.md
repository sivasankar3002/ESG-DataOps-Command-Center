# SOP — Daily Monitoring (Shift Start)

## Purpose

Standard first-hour routine for the ESG DataOps L1 on-call engineer. The daily DAG `esg_daily_ingestion` runs between 06:30 and 07:30 local time; this SOP verifies that the night's batch completed cleanly, triages anything that did not, and produces the daily status update. Total target time: 60 minutes from shift start.

## Scope

- Applies to every business day, performed by the L1 On-call engineer.
- Dashboard: ESG DataOps Command Center (tabs: Control Room, Overview, Pipeline Runs, File Ingestion, Data Quality, Incidents, Reconciliation, Runbooks, Daily Report).
- Companion SOPs: file arrival (docs/sop_file_arrival_check.md), validation failures (docs/sop_validation_failure_handling.md), incidents (docs/sop_incident_creation_and_update.md), escalation (docs/sop_escalation_matrix.md), reporting (docs/sop_daily_status_reporting.md).

## Schedule

| Time | Activity |
|---|---|
| 07:00 | Shift start; open the Control Room and Overview tabs |
| 07:00 - 07:50 | Checklist steps 1-6 below |
| 07:50 - 08:00 | Step 7: prepare the daily status update |
| 08:30 | Daily status update distributed at the latest |

## Health status definitions

| Status | Meaning | Action |
|---|---|---|
| GREEN | No failed jobs, no P1/P2 incidents, reconciliation pass | Continue routine monitoring |
| AMBER | Warnings, non-critical validation failures, or one P3 incident | Work the affected checklist item; no escalation yet unless criteria met |
| RED | Failed load, P1/P2 incident, missing mandatory file, or reconciliation failure | Immediate triage with the mapped runbook; P1 escalates immediately |
| NO_DATA | The pipeline has not produced data for the business date yet | Re-check after the DAG window closes (07:30) |

## Daily monitoring checklist

### Step 1 — Check file arrivals (07:00 - 07:10)

- Open the File Ingestion tab; confirm 3 of 3 expected feeds for the business date: site_master (expected 06:15), energy_consumption (06:30), carbon_emissions (06:40).
- Confirm each file shows a healthy status (RECEIVED -> VALIDATED -> PROCESSED) and no file is QUARANTINED or FAILED.
- If a file is missing: follow docs/sop_file_arrival_check.md and RB001. If a file is late beyond its SLA window: RB009.

### Step 2 — Check failed pipeline runs (07:10 - 07:20)

- Open the Pipeline Runs tab for the latest batch (format B-YYYYMMDD-NN).
- Confirm all eight tasks ended SUCCESS: file_sensor_task, ingest_and_validate_file_task, load_staging_task, run_data_quality_checks_task, load_warehouse_task, reconcile_source_to_target_task, generate_ops_report_task, notify_incident_task.
- Any FAILED task: identify it and follow the mapped runbook — load failures are P1 (RB008), escalate immediately.

### Step 3 — Check data quality failures (07:20 - 07:30)

- Open the Data Quality tab for the business date; every executed check should be PASS.
- For each FAIL or WARN check: triage per docs/sop_validation_failure_handling.md — read the check record, map the check name to its incident type, and follow the mapped runbook.
- Confirm the rejected-record ratio stayed within the 5 percent threshold (rejected_threshold_check).

### Step 4 — Check open incidents (07:30 - 07:40)

- Open the Incidents tab; list all incidents with status OPEN or IN_PROGRESS.
- For each: confirm the mapped runbook is attached, a work note exists with the last action, and the 240-minute auto-escalation clock is understood (created_at + 240 minutes).
- P1 incidents: verify immediate escalation has occurred; P2: verify progress; P3: verify they have an owner and a plan.

### Step 5 — Check reconciliation mismatches (07:40 - 07:45)

- Open the Reconciliation tab; source_to_target_rowcount_recon and source_to_target_aggregate_recon must be PASS for the batch.
- A FAIL means the warehouse does not tie to source: follow RB005, quantify the variance, and determine whether a re-run or an escalation is required.

### Step 6 — Check freshness (07:45 - 07:50)

- Open the Overview tab; the freshness KPI must show readings at least as recent as business date - 1 day (26-hour policy).
- If stale: follow RB010 — first look for a root-cause incident (missing/late file, load failure) and resolve that.

### Step 7 — Prepare daily status update (07:50 - 08:00)

- Open the Daily Report tab; review the generated report for the business date (details in docs/sop_daily_status_reporting.md).
- Verify the overall health rating (GREEN/AMBER/RED) matches what you observed in steps 1-6; regenerate the report if late-arriving fixes changed the numbers.
- Write the shift status update: overall health, open incidents with next actions, SLA/freshness status, and anything handed over to Data Engineering L2.
- Distribute by 08:30 to the ESG DataOps L1 group and stakeholders per the reporting SOP.

## Escalation reminders

- P1: escalate immediately to Data Engineering L2 and the on-call manager — never wait.
- P2: escalate if unresolved after 240 minutes (auto-escalation handles this, but do not rely on it).
- P3: escalate after one business day unresolved. P4: monitor only.
- Full matrix and contacts: docs/sop_escalation_matrix.md.

## End-of-shift handover

Before handover, record in the shift log: incidents opened/closed during the shift, incidents still open with the next action and escalation deadline, pending source-owner responses, and any runbook step that failed to work as written (feed back to the docs owner).
