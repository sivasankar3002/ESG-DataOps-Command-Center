# Escalation Handoff — INC-000008

**Incident:** freshness_check failed (batch B-20260827-01)
**Type:** FRESHNESS_FAILURE | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB010 — Freshness Failure

## Business impact
The warehouse has not received fresh data within the expected period; executive dashboards are stale.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260827-01, run esg_daily_ingestion.run_data_quality_checks_task.B-20260827-01)
- Business date: 2026-08-27
- File: n/a
- Table: fact_energy_emissions
- Check: freshness_check

## Error message
```
Warehouse is stale: latest reading_date 2026-08-24 is older than 2026-08-26
```

## Checks failed
- row_count_check [FAIL/HIGH] expected=29 actual=24
- freshness_check [FAIL/HIGH] expected=>= 2026-08-26 actual=2026-08-24

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Check whether upstream batches failed (Pipeline Runs tab) causing the staleness
- Once feeds recover, verify freshness check passes on the next run

## Senior escalation notes
- Evidence package location: B-20260827-01/INC-000008/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.