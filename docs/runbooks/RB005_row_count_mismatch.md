# RB005 — Row Count Mismatch

## Incident type

ROW_COUNT_MISMATCH

Raised automatically when any of the following checks fails:

- `row_count_check` — rows in the received file vs `expected_rows` declared in the manifest sidecar.
- `source_to_target_rowcount_recon` — validated source rows vs rows loaded into the warehouse.
- `source_to_target_aggregate_recon` — summed `energy_kwh` source vs target beyond the 0.01 kWh tolerance (`aggregate_tolerance` in `config/settings.yaml`).

## Severity guidance

P2 (severity mapping: ROW_COUNT_MISMATCH -> P2). Auto-created by the pipeline during `run_data_quality_checks_task` or `reconcile_source_to_target_task`; assigned to **ESG DataOps L1** / **L1 On-call**. Not every count variance raises an incident: `quarantined_file_check` and `rejected_threshold_check` report without creating incidents (see docs/sop_validation_failure_handling.md).

## Business impact

- Under-counts mean missing sites or readings in `fact_energy_emissions` for the business date; over-counts may indicate duplicates or a wrong file.
- Aggregate mismatches mean warehouse totals no longer tie to source — an audit and reporting-integrity problem for ESG disclosures.
- The daily ops report evaluates to RED when reconciliation fails.

## First-level checks

1. Control Room: note the batch_id and whether the DAG completed (row-count mismatches can occur with an otherwise green pipeline).
2. Data Quality tab: identify which of the three count checks failed; note `expected_value`, `actual_value` and `threshold_value`.
3. Reconciliation tab: open the source-to-target comparison; identify the affected dataset and the size and direction of the variance (short vs over).
4. Pipeline Runs tab: read `rows_read`, `rows_loaded` and `rows_rejected` for `load_staging_task` and `load_warehouse_task`.
5. File Ingestion tab: confirm all three feeds were received and none quarantined (a quarantined feed explains a whole-feed count gap — see RB002/RB003/RB004).
6. Incidents tab: open the ROW_COUNT_MISMATCH incident and its evidence package (`failed_rows.csv`, `query_results.json`).
7. Runbooks tab: confirm RB005 is the attached runbook.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN).

```sql
-- Q1: Which count checks failed, and by how much?
SELECT check_name, check_category, table_name, status, expected_value, actual_value,
       threshold_value, error_details
FROM dq_check_results
WHERE batch_id = '{batch_id}'
  AND check_name IN ('row_count_check', 'source_to_target_rowcount_recon',
                     'source_to_target_aggregate_recon')
ORDER BY check_name;

-- Q2: What did each pipeline task read, load and reject?
SELECT task_id, status, rows_read, rows_loaded, rows_rejected, error_message
FROM job_run_audit
WHERE batch_id = '{batch_id}'
ORDER BY sequence;

-- Q3: How many staging rows passed vs rejected validation (per dataset)?
SELECT dataset, validation_status, COUNT(*) AS row_count
FROM staging_energy_data
WHERE batch_id = '{batch_id}'
GROUP BY dataset, validation_status;

-- Q4: How many rows actually landed in the warehouse for the batch?
SELECT source_file_name, COUNT(*) AS fact_rows,
       ROUND(SUM(energy_kwh)::numeric, 2) AS total_kwh
FROM fact_energy_emissions
WHERE batch_id = '{batch_id}'
GROUP BY source_file_name;
```

## Expected normal result

- Q1: all three checks status PASS; row counts match exactly and the aggregate variance is within the 0.01 kWh tolerance.
- Q2: all tasks SUCCESS; `rows_read` = `rows_loaded` + `rows_rejected`, with rejections explainable and inside the 5 percent rejected-record threshold.
- Q3: predominantly `validation_status` VALID rows; any REJECTED rows carry a specific `rejection_reason`.
- Q4: fact rows per source file equal the VALID staging rows for that file; totals tie back to the source manifest.

## Possible root causes

Ranked by observed frequency:

- Validation rejections (NULL_VALUES, RANGE_VIOLATION, duplicates) reduced the loaded count — check `rejection_reason` in staging.
- Source delivered fewer or more rows than the manifest declared (source-side packaging defect).
- Duplicate `record_id` values deduplicated during load (cross-check RB006).
- Partial warehouse load after a transient failure leaving the batch half-loaded (follow RB008).
- A quarantined feed (empty file, checksum, schema drift) removing an entire file from the counts.

## Resolution steps

1. Quantify the variance from Q1 (absolute rows or kWh, and percentage) and identify the affected dataset and direction (short vs over).
2. Trace counts end to end: manifest `expected_rows` -> file rows (`rows_read`) -> staging VALID/REJECTED -> fact rows. Identify the first hop where the numbers diverge.
3. If validation rejections explain the gap: review the `rejection_reason` distribution; if a validation rule is wrong (not the data), escalate to Data Engineering L2 with sample rows from the evidence `failed_rows.csv`.
4. If the source short-delivered or over-delivered: request a corrected file from the source system owner and re-run the batch.
5. If staging is complete but the warehouse is short: treat as a load defect — follow RB008 and escalate.
6. After the correction, re-run the pipeline for the batch from the Control Room and confirm all three checks PASS on the Data Quality and Reconciliation tabs.
7. Resolve the incident documenting the variance, the root cause, and the final reconciled counts.

## Escalation criteria

Escalate to Data Engineering L2 if:

- The variance is not explained by validated rejections or a quarantined feed (suspected pipeline defect).
- Aggregate reconciliation still fails beyond the 0.01 kWh tolerance after a clean re-run.
- The incident is unresolved after 240 minutes — the escalation manager auto-escalates OPEN/IN_PROGRESS incidents past the threshold and reassigns them to Data Engineering L2.

## Related dashboard tab

Reconciliation (source-to-target evidence); supporting evidence on Data Quality, Pipeline Runs and Incidents.

## Related tables

- `dq_check_results`
- `job_run_audit`
- `staging_energy_data`
- `fact_energy_emissions`
- `file_ingestion_log`
- `incident_log`
