# RB004 — Schema Drift

## Incident type

SCHEMA_DRIFT

Raised automatically when `schema_header_validation` (category SCHEMA, severity CRITICAL) fails during `ingest_and_validate_file_task`: the header row of a received file does not match the `required_columns` list defined for the dataset in `config/data_quality_rules.yaml`. The file is quarantined and the feed's load is halted.

## Severity guidance

- P1 when a mandatory (required) column is missing — the data cannot be mapped or loaded safely.
- P2 for other header deviations (extra column, renamed optional column, reordered header).

The conditional severity is resolved from `config/settings.yaml` (SCHEMA_DRIFT_MANDATORY -> P1, SCHEMA_DRIFT_OPTIONAL -> P2). The incident is auto-created by the pipeline and assigned to **ESG DataOps L1**. A P1 drift must be worked immediately and escalated in parallel.

## Business impact

- The feed's records cannot be mapped: `staging_energy_data` / `staging_site_master` receive zero rows for the feed, so `fact_energy_emissions` / `dim_site` miss the business date.
- A P1 drift blocks the daily load and makes the daily ops report RED.
- If the drift were loaded undetected, a renamed mandatory column would silently null out key fields (`record_id`, `site_id`, `reading_date`, `energy_kwh`) — the quarantine prevents this data-integrity risk.

## First-level checks

1. Control Room: confirm the batch_id; a P1 SCHEMA_DRIFT should be the top item in the active incidents panel.
2. File Ingestion tab: identify the affected file; expect `file_status` = QUARANTINED, zone QUARANTINE, with a header-mismatch `error_message`.
3. Data Quality tab: open the `schema_header_validation` FAIL row; `error_details` names the missing or unexpected column(s); note `table_name` and `column_name`.
4. Incidents tab: open the SCHEMA_DRIFT incident and confirm whether severity is P1 (mandatory column affected) or P2 (optional/extra column) — this decides the escalation path.
5. Pipeline Runs tab: confirm the ingest task quarantined the file and that later tasks for the feed processed zero rows.
6. Quarantine zone: open the file in `data/quarantine` and compare its header line against the dataset's required columns (energy_consumption: record_id, site_id, reading_date, energy_kwh, emissions_co2e; carbon_emissions: record_id, site_id, reading_date, emissions_co2e; site_master: site_id, site_name, country, region, site_type, effective_from_date).
7. Runbooks tab: confirm RB004 is the runbook attached to the incident.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN); `{business_date}` = business date in YYYY-MM-DD form.

```sql
-- Q1: What exactly did schema_header_validation find (expected vs actual header)?
SELECT check_name, status, severity, table_name, column_name,
       expected_value, actual_value, error_details
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'schema_header_validation';

-- Q2: Was the drifted file quarantined?
SELECT file_name, dataset, file_status, zone, error_message
FROM file_ingestion_log
WHERE batch_id = '{batch_id}'
ORDER BY file_name;

-- Q3: What severity was assigned, and is the incident still open?
SELECT incident_id, incident_type, severity, status, short_description, affected_file, escalated_flag
FROM incident_log
WHERE batch_id = '{batch_id}'
  AND incident_type = 'SCHEMA_DRIFT';

-- Q4: Did any rows from the drifted feed reach staging (there should be none)?
SELECT dataset, validation_status, COUNT(*) AS row_count
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY dataset, validation_status;
```

## Expected normal result

- Q1: `schema_header_validation` status PASS; `expected_value` and `actual_value` both equal the dataset's required column list.
- Q2: three files, `file_status` PROCESSED, zone PROCESSED, `error_message` NULL.
- Q3: no rows returned.
- Q4: every dataset in the batch shows `validation_status` VALID rows; no feed missing.

## Possible root causes

Ranked by observed frequency:

- Source released a schema change (added, removed or renamed column) without change notification — the most common cause.
- Column reordering or an extra trailing column from a new export template.
- Delimiter or quoting change causing the header to parse into the wrong column set.
- Wrong file template dropped (for example a report variant instead of the standard extract).

## Resolution steps

1. Diff the actual header (first line of the quarantined file) against the dataset's `required_columns` in `config/data_quality_rules.yaml`.
2. Classify the drift: missing mandatory column (P1) versus optional/extra/reordered column (P2).
3. For a P1 (mandatory column missing): escalate immediately to Data Engineering L2 per docs/sop_escalation_matrix.md — a rules/config change or source rollback is required. L1 must not edit the YAML alone.
4. For a P2: confirm with the source owner whether the change is permanent; Data Engineering L2 updates `config/data_quality_rules.yaml` if the new header is accepted.
5. Ask the source owner to re-deliver a compliant file for the business date (or, after a rules update, re-run with the accepted file).
6. Re-run the pipeline for the batch from the Control Room once the file or the rule set is corrected.
7. Confirm on the Data Quality tab that `schema_header_validation` PASSes and the feed loads; verify staging and warehouse counts.
8. Resolve the incident documenting the header diff, the P1/P2 classification, the decision taken, and the verification results.

## Escalation criteria

Escalate to Data Engineering L2 immediately (do not wait) when:

- Severity is P1 — a mandatory column is missing; escalate on detection, in parallel with the investigation.
- The drift repeats after a compliant re-delivery.
- The fix requires changing `config/data_quality_rules.yaml` or the warehouse table structure.

Standard auto-escalation still applies as a backstop: unresolved OPEN/IN_PROGRESS incidents older than 240 minutes are escalated automatically.

## Related dashboard tab

Data Quality (schema_header_validation failure detail); supporting evidence on File Ingestion, Pipeline Runs and Incidents.

## Related tables

- `dq_check_results` (schema_header_validation)
- `file_ingestion_log`
- `staging_energy_data` / `staging_site_master`
- `incident_log`
