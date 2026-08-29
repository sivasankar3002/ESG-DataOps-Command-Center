# RB002 — Empty File

## Incident type

EMPTY_FILE

Raised automatically when the `empty_file_check` (category COMPLETENESS, severity CRITICAL) fails during `ingest_and_validate_file_task`: a feed file was received in `data/incoming` but contains zero data rows (header-only or zero bytes), or its recorded size is 0 bytes.

## Severity guidance

P2 (severity mapping: EMPTY_FILE -> P2). Auto-created by the pipeline; assigned to **ESG DataOps L1** / **L1 On-call**; linked to this runbook. Note that under the `validated_records_only` load policy an empty file results in zero rows staged and loaded for that feed even though the file itself is "present" — the business effect is close to a missing file (RB001).

## Business impact

- The feed contributes no records for the business date: `fact_energy_emissions` (or `dim_site` for site_master) has a gap for that date.
- Downstream `row_count_check` and `source_to_target_rowcount_recon` fail or see a zero-row source; `freshness_check` may fail on later evaluations; the daily report shows RED.
- Sustainability reporting for the affected date understates energy consumption and carbon emissions.

## First-level checks

1. Control Room: confirm the batch_id and overall health; an EMPTY_FILE incident usually coincides with row-count and reconciliation findings.
2. File Ingestion tab: locate the affected file; note `file_size_bytes` (0 or a header-only size of a few dozen bytes), `file_status` (expected QUARANTINED) and zone (expected QUARANTINE).
3. File Ingestion tab: read `error_message` on the file row — it records the empty-file reason from the validator.
4. Pipeline Runs tab: check `ingest_and_validate_file_task` and `load_staging_task` for the batch; `rows_read` should be 0 for the empty feed.
5. Data Quality tab: open the `empty_file_check` failure record; compare `expected_value` (manifest expected_rows) with `actual_value` (rows found).
6. Incidents tab: open the EMPTY_FILE incident; note incident_id, `created_at`, and the evidence package path under `evidence/{batch_id}/{incident_id}/`.
7. Quarantine zone: confirm the file was moved to `data/quarantine`, and inspect the manifest sidecar (`file.csv.manifest.json`) `expected_rows` value.
8. Daily Report tab: verify the day's health and file counters (files_received vs files_expected, files_quarantined).

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN); `{business_date}` = business date in YYYY-MM-DD form.

```sql
-- Q1: What is the recorded size and status of each file in the batch?
SELECT file_name, dataset, file_size_bytes, file_status, zone, error_message
FROM file_ingestion_log
WHERE batch_id = '{batch_id}'
ORDER BY file_name;

-- Q2: What did empty_file_check expect vs find?
SELECT check_name, status, severity, expected_value, actual_value, error_details, executed_at
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'empty_file_check';

-- Q3: How many rows from this batch reached staging (per dataset and validation status)?
SELECT dataset, validation_status, COUNT(*) AS row_count
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY dataset, validation_status;

-- Q4: What did the ingest task actually read?
SELECT task_id, status, rows_read, rows_loaded, rows_rejected, error_message
FROM job_run_audit
WHERE batch_id = '{batch_id}'
  AND task_id = 'ingest_and_validate_file_task';
```

## Expected normal result

- Q1: three files with non-trivial `file_size_bytes` (hundreds of bytes or more), `file_status` PROCESSED, zone PROCESSED, `error_message` NULL.
- Q2: `empty_file_check` status PASS; `actual_value` equals the manifest expected_rows and is at or above the dataset minimum (site_master 10, energy_consumption 10, carbon_emissions 5 rows).
- Q3: rows present with `validation_status` VALID for every feed in the batch; no feed missing entirely.
- Q4: ingest task status SUCCESS with `rows_read` matching the manifest expected_rows.

## Possible root causes

Ranked by observed frequency:

- Upstream export produced zero rows (source job defect, wrong date filter, or empty selection window).
- File truncated in transit — the transfer was interrupted so only the header row (or nothing) landed.
- Manifest/data mismatch: the sidecar declares expected_rows > 0 while the file is empty (source-side packaging error).
- Source deliberately sent an empty feed (for example, no meter activity that day) without notifying operations — this must be confirmed with the source owner, never assumed.

## Resolution steps

1. Confirm the file is genuinely empty: check `file_size_bytes` in Q1 and the physical file in `data/quarantine`.
2. Read the manifest sidecar and note `expected_rows`; if it is greater than 0, the source intended to send data and this is a delivery defect.
3. Contact the source system owner (ESG-IOT-HUB / CARBON-LEDGER-API / FACILITIES-MDM) and request a full re-export for the business date.
4. Set the incident IN_PROGRESS and add a work note with the source-owner contact and expected re-delivery time.
5. When the corrected file is re-delivered to `data/incoming`, re-run the pipeline for the batch from the Control Room.
6. Watch the File Ingestion tab until the feed transitions RECEIVED -> VALIDATING -> VALIDATED -> PROCESSING -> PROCESSED, and confirm `empty_file_check` now PASSes.
7. Confirm staging and warehouse rows for the feed, and that `row_count_check` and the reconciliation checks pass.
8. Resolve the incident with notes documenting the empty-file cause, the source-owner contact, and the re-delivery timestamps.

## Escalation criteria

Escalate to Data Engineering L2 if:

- The source owner confirms a correct export but the file is still empty on re-delivery (points to a transfer or parser defect).
- The same feed arrives empty on two consecutive business days.
- The incident remains unresolved for 240 minutes — the escalation manager auto-escalates OPEN/IN_PROGRESS incidents past the threshold to Data Engineering L2.

## Related dashboard tab

File Ingestion (file size and quarantine status); supporting evidence on Data Quality, Incidents and the Daily Report counters.

## Related tables

- `file_ingestion_log`
- `dq_check_results` (empty_file_check)
- `job_run_audit` (ingest_and_validate_file_task, load_staging_task)
- `staging_energy_data` / `staging_site_master`
- `incident_log`
