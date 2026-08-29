# RB003 — Checksum Mismatch / Corrupted File

## Incident type

CHECKSUM_MISMATCH — this runbook also covers FILE_CORRUPTED incidents.

Raised automatically when `checksum_validation` (category INTEGRITY, severity CRITICAL) fails during `ingest_and_validate_file_task`: the SHA-256 computed over the received file does not equal `checksum_sha256` declared in the manifest sidecar (`file.csv.manifest.json`). The pipeline sets `checksum_status` = INVALID, quarantines the file (zone QUARANTINE), and halts that feed's load.

## Severity guidance

P2 (severity mapping: CHECKSUM_MISMATCH -> P2, FILE_CORRUPTED -> P2). Auto-created by the pipeline; assigned to **ESG DataOps L1** / **L1 On-call**. The quarantined file halts the feed's load under the `validated_records_only` policy, so treat it as a same-morning action item — the SLA clock is running.

## Business impact

- The affected feed's data does not enter staging or the warehouse for the business date: integrity cannot be guaranteed for the bytes received.
- Downstream row-count and reconciliation checks fail or see a missing source; freshness degrades once the last good reading ages past the 26-hour policy.
- Loading a corrupted file without checksum control would risk silent data corruption in `fact_energy_emissions` — never bypass the quarantine to "keep the numbers green".

## First-level checks

1. Control Room: note the batch_id and overall health; a checksum failure typically turns the day RED once reconciliation evaluates.
2. File Ingestion tab: find the affected file; confirm `checksum_status` = INVALID, note `checksum_algorithm`, and confirm `file_status` = QUARANTINED with zone QUARANTINE.
3. File Ingestion tab: read `error_message` — it records the computed vs expected digest.
4. Data Quality tab: open the `checksum_validation` FAIL row; compare `expected_value` (manifest digest) with `actual_value` (computed digest).
5. Incidents tab: open the CHECKSUM_MISMATCH (or FILE_CORRUPTED) incident; note incident_id, `created_at` and the evidence package path.
6. Pipeline Runs tab: confirm `ingest_and_validate_file_task` completed with the file quarantined, and that the feed contributed zero rows to `load_staging_task`.
7. Quarantine zone: confirm the suspect file was moved to `data/quarantine` and no longer sits in `data/incoming`.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN); `{business_date}` = business date in YYYY-MM-DD form.

```sql
-- Q1: What is the checksum state of every file in the batch?
SELECT file_name, dataset, checksum_algorithm, checksum_status, checksum_value,
       file_status, zone, error_message
FROM file_ingestion_log
WHERE batch_id = '{batch_id}'
ORDER BY file_name;

-- Q2: What did checksum_validation record (expected vs computed digest)?
SELECT check_name, status, severity, expected_value, actual_value, error_details, executed_at
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'checksum_validation';

-- Q3: Was an incident raised, and is it still open?
SELECT incident_id, incident_type, severity, status, affected_file, escalated_flag, evidence_path
FROM incident_log
WHERE batch_id = '{batch_id}'
  AND incident_type IN ('CHECKSUM_MISMATCH', 'FILE_CORRUPTED');

-- Q4: Did any rows from this batch reach the warehouse (the quarantined feed must contribute none)?
SELECT source_file_name, COUNT(*) AS fact_rows
FROM fact_energy_emissions
WHERE batch_id = '{batch_id}'
GROUP BY source_file_name;
```

## Expected normal result

- Q1: three files, all with `checksum_status` = VALID, `file_status` = PROCESSED, zone PROCESSED, `error_message` NULL. (SKIPPED can appear only for files without a manifest; all daily feeds carry manifests.)
- Q2: `checksum_validation` status PASS with matching expected and actual digests.
- Q3: no rows returned.
- Q4: rows present only for feeds that passed validation; the quarantined feed contributes none.

## Possible root causes

Ranked by observed frequency:

- File truncated or altered in transit (partial upload, interrupted SFTP/S3 transfer) — the most common cause.
- Source regenerated the file after producing the manifest, so the digest no longer matches by design.
- Manifest sidecar stale or copied from a previous day's export.
- Delimiter or encoding change at the source altering file bytes without a functional schema change (cross-check RB004).

## Resolution steps

1. Verify the mismatch independently: recompute the SHA-256 of the quarantined file in `data/quarantine` and compare it against `checksum_sha256` in the manifest sidecar.
2. Compare file sizes against the source's expectation; a much smaller file indicates truncation.
3. Request a full re-delivery (data file plus a fresh manifest) from the source system owner.
4. Set the incident IN_PROGRESS with a work note capturing both digests and the source-owner contact.
5. On re-delivery to `data/incoming`, confirm the new manifest digest, then re-run the pipeline for the batch from the Control Room.
6. Watch the File Ingestion tab until the feed shows `checksum_status` = VALID and `file_status` = PROCESSED.
7. Confirm downstream checks on the Data Quality and Reconciliation tabs: `row_count_check`, `source_to_target_rowcount_recon` and `source_to_target_aggregate_recon` all PASS.
8. Resolve the incident recording the digests compared, the re-delivery time, and the source owner contacted.

## Escalation criteria

Escalate to Data Engineering L2 if:

- Re-delivered files keep failing checksum validation (transport-level defect or transfer tooling problem).
- The mismatch is caused by an unannounced source-side file-format change — coordinate with RB004 (Schema Drift) handling.
- The incident is unresolved after 240 minutes — the escalation manager auto-escalates OPEN/IN_PROGRESS incidents past the threshold to Data Engineering L2; an SLA_BREACH follow-on (RB009) may appear if the feed misses its window.

## Related dashboard tab

File Ingestion (checksum status per file); supporting evidence on Data Quality, Incidents and Reconciliation.

## Related tables

- `file_ingestion_log`
- `dq_check_results` (checksum_validation)
- `incident_log`
- `job_run_audit`
- `fact_energy_emissions` (verify the feed loaded after re-delivery)
