# Escalation Handoff — INC-000010

**Incident:** duplicate_record_check failed for energy_consumption (batch B-20260828-01)
**Type:** DUPLICATE_RECORDS | **Severity:** P3 | **Status:** OPEN
**Runbook:** RB006 — Duplicate Records

## Business impact
Duplicate meter readings would double-count consumption; duplicates are rejected, but the source-side duplication bug must be reported.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260828-01, run esg_daily_ingestion.run_data_quality_checks_task.B-20260828-01)
- Business date: 2026-08-28
- File: n/a
- Table: staging_energy_data
- Check: duplicate_record_check

## Error message
```
2 duplicate record_id occurrence(s) rejected during staging load
```

## Checks failed
- sla_check [FAIL/HIGH] expected=<= 06:30+4h actual=late arrival
- duplicate_record_check [FAIL/MEDIUM] expected=0 actual=2

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Report duplicate record_ids to the source system owner
- Confirm rejected duplicates did not include newer readings (late vs replayed records)

## Senior escalation notes
- Evidence package location: B-20260828-01/INC-000010/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.