# Escalation Handoff — INC-000007

**Incident:** Row count mismatch: energy_consumption_2026-08-27.csv delivered 24 rows but the manifest expected 29
**Type:** ROW_COUNT_MISMATCH | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB005 — Row Count Mismatch

## Business impact
Control totals disagree between source manifest and file content; possible data loss or truncation in transit.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260827-01, run esg_daily_ingestion.ingest_and_validate_file_task.B-20260827-01)
- Business date: 2026-08-27
- File: energy_consumption_2026-08-27.csv
- Table: file_ingestion_log
- Check: row_count_check

## Error message
```
Row count variance -5 vs manifest expected_rows
```

## Checks failed
- row_count_check [FAIL/HIGH] expected=29 actual=24

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Reconcile expected_rows in the manifest vs actual file rows
- Confirm with the source owner whether records were dropped during extraction

## Senior escalation notes
- Evidence package location: B-20260827-01/INC-000007/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.