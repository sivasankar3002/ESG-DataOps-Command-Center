# Escalation Handoff — INC-000009

**Incident:** SLA breach: energy_consumption_2026-08-28.csv arrived 77 min after the 4h SLA window
**Type:** SLA_BREACH | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB009 — SLA Breach / Late File

## Business impact
The feed arrived outside its SLA window; downstream consumers (finance, sustainability reporting) may consume stale data.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260828-01, run esg_daily_ingestion.file_sensor_task.B-20260828-01)
- Business date: 2026-08-28
- File: energy_consumption_2026-08-28.csv
- Table: file_ingestion_log
- Check: sla_check

## Error message
```
File arrived at 2026-08-28T11:47:00.000Z — after SLA deadline 2026-08-28T10:30:00.000Z
```

## Checks failed
- sla_check [FAIL/HIGH] expected=<= 06:30+4h actual=late arrival

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Review arrival timestamp vs SLA window in file_ingestion_log
- If recurrent, raise a supplier performance ticket with the source system owner

## Senior escalation notes
- Evidence package location: B-20260828-01/INC-000009/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.