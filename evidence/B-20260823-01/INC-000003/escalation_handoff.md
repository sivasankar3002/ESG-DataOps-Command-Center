# Escalation Handoff — INC-000003

**Incident:** null_check_mandatory failed for energy_consumption (batch B-20260823-01)
**Type:** NULL_VALUES | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB007 — Null / Invalid Values

## Business impact
Mandatory attributes are missing on some records; those records cannot be attributed to a site and are rejected.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260823-01, run esg_daily_ingestion.run_data_quality_checks_task.B-20260823-01)
- Business date: 2026-08-23
- File: energy_consumption_2026-08-23.csv
- Table: staging_energy_data
- Check: null_check_mandatory

## Error message
```
Null/missing values in mandatory column(s): site_id=2
```

## Checks failed
- null_check_mandatory [FAIL/HIGH] expected=0 actual=2

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Identify affected records in failed_rows.csv and report to the source owner
- Confirm whether site onboarding in the master is lagging the meter feed

## Senior escalation notes
- Evidence package location: B-20260823-01/INC-000003/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.