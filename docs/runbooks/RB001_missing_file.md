# RB001 — Missing File

## Incident type

FILE_MISSING

Raised automatically when the `file_arrival_check` (category COMPLETENESS, severity CRITICAL) fails during the `file_sensor_task` step of the `esg_daily_ingestion` DAG: a feed declared mandatory in `config/file_manifest.yaml` has no corresponding entry in `file_ingestion_log` for the business date.

## Severity guidance

P2 (severity mapping in `config/settings.yaml`: FILE_MISSING -> P2). Auto-created by the pipeline when the check fails; assigned to assignment group **ESG DataOps L1**, assignee **L1 On-call**, and linked to this runbook. All three daily feeds are mandatory, so each missing feed raises its own P2 incident.

## Business impact

- The feed's data for the business date is absent from staging and the warehouse (`dim_site` / `fact_energy_emissions`), so ESG energy and emissions reporting is incomplete for that date.
- Downstream checks (`row_count_check`, `freshness_check`, `source_to_target_rowcount_recon`) may fail or report NO_DATA, creating follow-on incidents.
- The daily ops report evaluates to RED because a mandatory file is missing, and the gap must be backfilled later, increasing reconciliation and audit effort.

## First-level checks

1. Control Room: confirm the affected batch_id (format B-YYYYMMDD-NN) and the overall health indicator for the day.
2. File Ingestion tab: compare files expected vs files received for the batch; identify which of `site_master_YYYY-MM-DD.csv`, `energy_consumption_YYYY-MM-DD.csv`, `carbon_emissions_YYYY-MM-DD.csv` is absent.
3. File Ingestion tab: check whether the file appears with `file_status` FAILED or zone INCOMING (received but stuck) rather than being entirely absent.
4. Pipeline Runs tab: check the status of `file_sensor_task` for the run — a FAILED or timed-out sensor is what raised the incident.
5. Incidents tab: open the FILE_MISSING incident; record the incident_id (format INC-NNNNNN), confirm severity P2, and note `created_at` for SLA and escalation tracking.
6. Overview tab: check the alerts feed and the freshness KPI to see whether the missing file is already degrading warehouse freshness.
7. Landing zone: list `data/incoming` (simulated SFTP/S3 drop) and confirm the data file and its manifest sidecar (`file.csv.manifest.json`) are truly absent, not merely misnamed.
8. Runbooks tab: confirm RB001 is the runbook linked from the incident.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN, e.g. B-20250601-01); `{business_date}` = business date in YYYY-MM-DD form; `{dataset}` = one of `site_master`, `energy_consumption`, `carbon_emissions`.

```sql
-- Q1: Which files were registered for the affected batch, and in what state?
SELECT file_name, dataset, file_status, zone, checksum_status, error_message
FROM file_ingestion_log
WHERE batch_id = '{batch_id}'
ORDER BY file_name;

-- Q2: What did the file_arrival_check conclude for this business date?
SELECT check_name, status, severity, expected_value, actual_value, error_details, executed_at
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'file_arrival_check'
ORDER BY executed_at DESC;

-- Q3: Was a FILE_MISSING incident raised for this batch, and has it escalated?
SELECT incident_id, severity, status, short_description, affected_file, escalated_flag, created_at
FROM incident_log
WHERE incident_type = 'FILE_MISSING'
  AND batch_id = '{batch_id}';

-- Q4: Has this feed arrived on recent business days (one-off or pattern)?
SELECT expected_arrival_date, file_name, file_status, received_at
FROM file_ingestion_log
WHERE dataset = '{dataset}'
ORDER BY expected_arrival_date DESC
LIMIT 7;
```

## Expected normal result

- Q1: exactly three rows (one per mandatory feed); after a successful run all show `file_status` PROCESSED and zone PROCESSED with `error_message` NULL.
- Q2: `file_arrival_check` status PASS with expected and actual feed counts matching (e.g. expected 3 / actual 3); no FAIL rows.
- Q3: no rows — no FILE_MISSING incident exists for a healthy batch.
- Q4: one row per recent business date, with `received_at` shortly after the expected arrival time (site_master 06:15, energy_consumption 06:30, carbon_emissions 06:40).

## Possible root causes

Ranked by observed frequency:

- Source system outage or export-job failure at the owning system (ESG-IOT-HUB, CARBON-LEDGER-API or FACILITIES-MDM) — the file was never produced.
- Late delivery: file produced but still in transit when the sensor window closed (typically becomes SLA_BREACH, see RB009).
- Naming drift: the file landed with a name that does not match the `dataset_YYYY-MM-DD.csv` pattern, so the sensor did not match it.
- File dropped into the wrong landing-zone directory instead of `data/incoming`.
- Manifest sidecar delivered without the data file, or vice versa.

## Resolution steps

1. Verify the file is genuinely absent from `data/incoming` (check both the data file and its `.manifest.json` sidecar).
2. Identify the owning source system from `config/file_manifest.yaml` and open a delivery request with the source system owner (contact table in docs/sop_escalation_matrix.md).
3. Set the incident IN_PROGRESS with a work note recording the source-owner contact while you wait.
4. Wait for re-delivery while the feed is still inside its SLA window (site_master 2h -> deadline 08:15; energy_consumption 4h -> 10:30; carbon_emissions 4h -> 10:40). Monitor the File Ingestion tab for arrival.
5. When the file lands, trigger a pipeline re-run for the batch from the Control Room; the sensor picks up the file and continues ingest -> validate -> stage -> load -> reconcile.
6. Confirm on the File Ingestion tab that `file_status` reaches PROCESSED, and on Pipeline Runs that all eight tasks end SUCCESS.
7. Re-run the queries above; confirm `file_arrival_check` PASSes and downstream checks (row_count_check, freshness_check, reconciliation) pass.
8. Resolve the incident documenting arrival time, re-run outcome and reconciliation result (see docs/sop_incident_creation_and_update.md).

## Escalation criteria

Escalate to Data Engineering L2 when any of the following holds:

- The file has not arrived by the end of the feed's SLA window (08:15 / 10:30 / 10:40 as above) and the source owner cannot confirm delivery.
- The same feed is missing on two consecutive business days (systemic source problem).
- The incident remains unresolved for 240 minutes — the escalation manager auto-escalates OPEN/IN_PROGRESS incidents older than the 240-minute threshold and hands them to Data Engineering L2. Do not wait for the sweep when the situation is clearly beyond L1.

## Related dashboard tab

File Ingestion (arrival status per feed); supporting evidence on Pipeline Runs, Incidents and the Overview health banner.

## Related tables

- `file_ingestion_log` (arrival, status, zone)
- `dq_check_results` (file_arrival_check outcome)
- `incident_log` (FILE_MISSING incident record)
- `job_run_audit` (file_sensor_task execution)
- `fact_energy_emissions` / `dim_site` (downstream impact)
