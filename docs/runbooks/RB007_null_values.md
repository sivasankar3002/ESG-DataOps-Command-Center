# RB007 — Null / Invalid Values

## Incident type

NULL_VALUES — nulls in mandatory columns. Mandatory columns per `config/data_quality_rules.yaml`: energy_consumption — record_id, site_id, reading_date, energy_kwh; carbon_emissions — record_id, site_id, reading_date, emissions_co2e; site_master — site_id, site_name, country.

RANGE_VIOLATION — negative `energy_kwh` / `emissions_co2e` (numeric range minimum 0), or invalid `reading_date` values (expected format YYYY-MM-DD, checked by `date_validity_check`).

This runbook covers both incident types.

## Severity guidance

- NULL_VALUES: P2 when a mandatory column is affected, P3 otherwise (settings mapping: NULL_VALUES_MANDATORY -> P2, NULL_VALUES_OPTIONAL -> P3).
- RANGE_VIOLATION: P3.

Incidents are auto-created when `null_check_mandatory`, `date_validity_check` or `numeric_range_check` fail during `run_data_quality_checks_task`. Affected rows are rejected in staging under the `validated_records_only` policy — the incident tracks the data defect.

## Business impact

- Null keys or measures make individual readings unusable; rejecting them creates gaps in `fact_energy_emissions` for specific sites and dates.
- Negative `energy_kwh` or `emissions_co2e` would corrupt consumption and carbon totals (and any derived intensity KPIs) if loaded.
- Invalid `reading_date` values break freshness evaluation and time-series reporting.
- Mandatory-column nulls at scale (P2) can leave the feed below its minimum expected rows and trigger follow-on row-count findings (RB005).

## First-level checks

1. Control Room: note the batch_id and health; record-level defects typically keep the day AMBER unless the rejection ratio breaches 5 percent.
2. Data Quality tab: identify which checks failed (`null_check_mandatory`, `date_validity_check`, `numeric_range_check`); note `column_name`, expected/actual values, status and severity.
3. Incidents tab: open the NULL_VALUES or RANGE_VIOLATION incident; confirm whether severity is P2 (mandatory column) or P3.
4. Pipeline Runs tab: check `rows_rejected` for the batch and compare against `rows_read` to get the rejection percentage.
5. File Ingestion tab: confirm the feed was received and not quarantined (record-level defects do not quarantine the file).
6. Incidents tab: open the evidence package under `evidence/{batch_id}/{incident_id}/`; `failed_rows.csv` lists each rejected record with its reason.
7. Daily Report tab: verify the day's overall health and the rejected-record ratio.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN).

```sql
-- Q1: Which completeness/validity checks failed, on which columns?
SELECT check_name, check_category, table_name, column_name, status, severity,
       expected_value, actual_value, error_details
FROM dq_check_results
WHERE batch_id = '{batch_id}'
  AND check_name IN ('null_check_mandatory', 'date_validity_check', 'numeric_range_check')
ORDER BY check_name;

-- Q2: Which specific staged rows are defective (null or negative measures, null keys/dates)?
SELECT record_id, site_id, reading_date, energy_kwh, emissions_co2e,
       validation_status, rejection_reason
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
  AND (record_id IS NULL OR site_id IS NULL OR reading_date IS NULL
       OR energy_kwh IS NULL OR energy_kwh < 0
       OR emissions_co2e IS NULL OR emissions_co2e < 0)
LIMIT 50;

-- Q3: What is the rejection breakdown for the batch?
SELECT validation_status, rejection_reason, COUNT(*) AS row_count
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY validation_status, rejection_reason
ORDER BY row_count DESC;

-- Q4: Are the loaded warehouse values clean (bounds sanity check)?
SELECT MIN(energy_kwh) AS min_kwh, MAX(energy_kwh) AS max_kwh,
       MIN(reading_date) AS min_reading_date, MAX(reading_date) AS max_reading_date
FROM fact_energy_emissions
WHERE batch_id = '{batch_id}';
```

## Expected normal result

- Q1: all three checks status PASS; no FAIL rows.
- Q2: no rows returned — every staged record is complete and in range.
- Q3: all rows `validation_status` VALID, or a small, explainable set of REJECTED rows.
- Q4: `min_kwh` >= 0; the `reading_date` range spans only the expected business window; no NULL bounds.

## Possible root causes

Ranked by observed frequency:

- IoT meter outage or missing site mapping at ESG-IOT-HUB producing null readings — the most common cause of nulls.
- Meter reset or export defect producing negative `energy_kwh`.
- Date format change or timezone bug at the source producing invalid `reading_date` values.
- Site not yet present in the site master (unmapped `site_id`; cross-check `referential_integrity_check`).
- Occasional single-row sensor glitches — small counts, non-systemic.

## Resolution steps

1. Classify the defect from Q1: which column, which check, mandatory or optional. This confirms the incident severity (P2 vs P3).
2. List the affected records from Q2 or the evidence `failed_rows.csv`, and quantify the rejection percentage (`rows_rejected` / `rows_read` from the Pipeline Runs tab).
3. If the rejection ratio is within the 5 percent threshold and the records are isolated: document, allow the corrected data to arrive with the next feed, and track the incident as P3.
4. If a mandatory column is affected (P2) or the ratio breaches 5 percent: contact the source system owner with the record list and request a corrected extract for the business date.
5. Re-run the batch after re-delivery; confirm the three checks PASS and Q2 returns no rows.
6. Confirm the warehouse bounds in Q4 remain sane (no negatives, expected date window).
7. Resolve the incident with a defect summary (column, record count, rejection ratio), the source-owner response, and confirmation that no defective row reached the warehouse.

## Escalation criteria

Escalate to Data Engineering L2 if:

- A mandatory column is null at scale (P2 path) and the source cannot re-deliver within the SLA window.
- Negative or out-of-range values persist across multiple business days (systemic export defect).
- The rejected-record ratio exceeds 5 percent (`rejected_threshold_check` FAIL) — the batch is flagged.

Auto-escalation applies at 240 minutes unresolved for P2 incidents; per the escalation matrix, P3 incidents are escalated after one business day.

## Related dashboard tab

Data Quality (check-level failure detail); supporting evidence on Incidents, Pipeline Runs and the Daily Report.

## Related tables

- `dq_check_results`
- `staging_energy_data` (site_master nulls: `staging_site_master`)
- `fact_energy_emissions`
- `incident_log`
