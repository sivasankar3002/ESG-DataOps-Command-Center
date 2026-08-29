# RB006 — Duplicate Records

## Incident type

DUPLICATE_RECORDS

Raised automatically when `duplicate_record_check` (category UNIQUENESS, severity MEDIUM) fails during `run_data_quality_checks_task`: the same primary key appears more than once within a dataset. energy_consumption and carbon_emissions key on `record_id`; site_master keys on `site_id`.

## Severity guidance

P3 (severity mapping: DUPLICATE_RECORDS -> P3). Auto-created by the pipeline; assigned to **ESG DataOps L1** / **L1 On-call**. Duplicated rows are rejected in staging (`validation_status` = REJECTED) under the `validated_records_only` policy, so the warehouse stays consistent — the incident tracks the source-side defect.

## Business impact

- Double-counted records would overstate energy consumption and carbon emissions if loaded; the pipeline prevents this by rejecting duplicates before the warehouse.
- A growing duplicate rate indicates a source-side extraction defect (for example overlapping export windows) that keeps rejecting rows and may eventually breach the 5 percent rejected-record threshold.
- Rejected duplicates reduce loaded row counts and can trigger follow-on ROW_COUNT_MISMATCH findings (RB005).

## First-level checks

1. Control Room: note the batch_id and overall health; duplicates alone typically keep the day AMBER.
2. Data Quality tab: open the `duplicate_record_check` FAIL row; note `table_name`, `column_name`, and `expected_value` vs `actual_value` (duplicate count).
3. Incidents tab: open the DUPLICATE_RECORDS incident (P3); note incident_id, `affected_file`, and the evidence path (`failed_rows.csv` lists the duplicated keys).
4. File Ingestion tab: confirm the feed itself was not quarantined — duplicates are a record-level defect, not a file-level one.
5. Pipeline Runs tab: check `rows_rejected` on `run_data_quality_checks_task` and `load_warehouse_task`; rejected duplicates appear there.
6. Daily Report tab: check the day's health and whether the rejected-record ratio stayed within the 5 percent threshold (`rejected_threshold_check`).

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN).

```sql
-- Q1: What did duplicate_record_check find?
SELECT check_name, status, severity, table_name, column_name,
       expected_value, actual_value, error_details
FROM dq_check_results
WHERE batch_id = '{batch_id}'
  AND check_name = 'duplicate_record_check';

-- Q2: Which record_ids are duplicated inside this batch's staging data?
SELECT record_id, COUNT(*) AS occurrences
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY record_id
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 20;

-- Q3: Were the duplicates rejected (they must not reach the warehouse)?
SELECT validation_status, rejection_reason, COUNT(*) AS row_count
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY validation_status, rejection_reason
ORDER BY row_count DESC;

-- Q4: Do any duplicates exist in the warehouse across batches (key + date)?
SELECT record_id, reading_date, COUNT(*) AS fact_rows
FROM fact_energy_emissions
GROUP BY record_id, reading_date
HAVING COUNT(*) > 1
ORDER BY fact_rows DESC
LIMIT 20;
```

## Expected normal result

- Q1: `duplicate_record_check` status PASS; duplicate count 0.
- Q2: no rows returned.
- Q3: all rows `validation_status` VALID, or a small set of REJECTED rows with an explicit duplicate-related `rejection_reason`.
- Q4: no rows returned — each `record_id` + `reading_date` appears exactly once in `fact_energy_emissions`.

## Possible root causes

Ranked by observed frequency:

- Source re-sent part of the feed (overlapping export window) so records appear twice.
- Upstream join fan-out in the source extract creating repeated `record_id` values.
- Same-day re-delivery of a corrected file without withdrawing the original.
- site_master duplicates: multiple active rows per `site_id` in the FACILITIES-MDM snapshot.

## Resolution steps

1. List the duplicated keys from Q2 or the evidence `failed_rows.csv`; count the affected records and compute the rejection percentage against `rows_read`.
2. Check whether duplicates also exist in the raw file in `data/processed` — this confirms source-side duplication rather than a pipeline double-read.
3. Confirm the duplicates were rejected in staging (Q3) and that the warehouse shows a single row per key (Q4). If not, escalate immediately.
4. Inform the source system owner with the duplicated key list and request a corrected extract for the business date.
5. Re-run the batch after the corrected file arrives, and confirm `duplicate_record_check` PASSes.
6. Monitor the next three business days for recurrence (systemic duplication pattern).
7. Resolve the incident documenting the duplicated key count, the rejection percentage, the source-owner response, and confirmation that the warehouse remained deduplicated.

## Escalation criteria

Escalate to Data Engineering L2 if:

- Duplicated keys are found in `fact_energy_emissions` (Q4 returns rows) — warehouse cleanup is required.
- The rejected-duplicate ratio exceeds the 5 percent rejected-record threshold (`rejected_threshold_check` FAIL).
- Duplicates recur across three or more consecutive business days.

Standard auto-escalation applies after 240 minutes unresolved; per the escalation matrix, P3 incidents are also escalated after one business day unresolved.

## Related dashboard tab

Data Quality (duplicate_record_check evidence); supporting evidence on Incidents, Pipeline Runs and the Daily Report (rejected-record ratio).

## Related tables

- `dq_check_results`
- `staging_energy_data` (site_master duplicates: `staging_site_master`)
- `fact_energy_emissions` (site_master: `dim_site`)
- `incident_log`
