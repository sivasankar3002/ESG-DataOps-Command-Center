# Escalation Handoff — INC-000004

**Incident:** Schema drift: energy_consumption_2026-08-25.csv is missing column(s) [site_id] — quarantined
**Type:** SCHEMA_DRIFT | **Severity:** P1 | **Status:** OPEN
**Runbook:** RB004 — Schema Drift

## Business impact
The source system changed its file contract; automated loads will keep failing until the schema is confirmed and the contract updated.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260825-01, run esg_daily_ingestion.ingest_and_validate_file_task.B-20260825-01)
- Business date: 2026-08-25
- File: energy_consumption_2026-08-25.csv
- Table: file_ingestion_log
- Check: schema_header_validation

## Error message
```
Missing column(s): site_id
```

## Checks failed
- schema_header_validation [FAIL/CRITICAL] expected=record_id,site_id,reading_date,energy_kwh,emissions_co2e actual=record_id,reading_date,energy_kwh,emissions_co2e

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Confirm the schema change with the source system owner
- If legitimate: update config/data_quality_rules.yaml required_columns and file a change ticket
- If not legitimate: request re-delivery in the contracted format

## Senior escalation notes
- Evidence package location: B-20260825-01/INC-000004/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.