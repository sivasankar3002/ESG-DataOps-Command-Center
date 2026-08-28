# Escalation Handoff — INC-000002

**Incident:** Missing file: carbon_emissions_2026-08-21.csv expected by 06:40 (SLA 4h) was not found in the landing zone
**Type:** FILE_MISSING | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB001 — Missing File

## Business impact
Downstream ESG reporting is blocked for the affected date; sustainability KPIs (energy/emissions) will be incomplete until the feed is recovered.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260821-01, run esg_daily_ingestion.file_sensor_task.B-20260821-01)
- Business date: 2026-08-21
- File: carbon_emissions_2026-08-21.csv
- Table: file_ingestion_log
- Check: file_arrival_check

## Error message
```
Expected feed carbon_emissions_2026-08-21.csv (source: CARBON-LEDGER-API) not found in landing zone
```

## Checks failed
- file_arrival_check [FAIL/CRITICAL] expected=carbon_emissions_2026-08-21.csv actual=not received

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Contact the source system owner (see manifest source_system) and request re-delivery
- If re-delivery is not possible before the reporting cut-off, prepare a partial-load note for consumers

## Senior escalation notes
- Evidence package location: B-20260821-01/INC-000002/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.