# Escalation Handoff — INC-000005

**Incident:** Checksum mismatch: energy_consumption_2026-08-26.csv failed SHA256 integrity validation against its manifest — file quarantined
**Type:** CHECKSUM_MISMATCH | **Severity:** P2 | **Status:** OPEN
**Runbook:** RB003 — Checksum Mismatch / Corrupted File

## Business impact
File integrity cannot be proven; loading unverified data risks corrupting the warehouse. Load is halted pending re-delivery.

## Affected pipeline / file / table
- Pipeline: esg_daily_ingestion (batch B-20260826-01, run esg_daily_ingestion.ingest_and_validate_file_task.B-20260826-01)
- Business date: 2026-08-26
- File: energy_consumption_2026-08-26.csv
- Table: file_ingestion_log
- Check: checksum_validation

## Error message
```
SHA256 mismatch — file content does not match the manifest control record (possible corruption/truncation in transit)
```

## Checks failed
- checksum_validation [FAIL/CRITICAL] expected=deadbe87442f31e9… actual=33f6fe87442f31e9…

## First-level actions already performed
- Checked file arrival status on the dashboard (File Ingestion tab)
- Reviewed the failed checks in dq_check_results for the batch
- Collected pipeline logs, failed rows and query results as evidence (this package)
- Validated whether the issue is reproducible for other dates/datasets

## Recommended next steps
- Request re-delivery with a correct checksum manifest
- Check transfer logs for truncation or encoding issues in the SFTP/S3 channel

## Senior escalation notes
- Evidence package location: B-20260826-01/INC-000005/
- Full structured log: error_log.txt in this package
- Rejected rows sample: failed_rows.csv in this package
- Assign to Data Engineering L2 if next steps exceed L1 scope.