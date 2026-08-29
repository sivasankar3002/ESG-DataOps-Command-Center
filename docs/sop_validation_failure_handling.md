# SOP — Validation Failure Handling

## Purpose

Define the standard triage flow when a data-quality (DQ) check fails or warns during the `esg_daily_ingestion` pipeline: read the check result, map it to the incident type and runbook, and decide the load impact. Checks and thresholds are configured in `config/data_quality_rules.yaml`.

## Triage flow

1. Detect the failure. Open the Data Quality tab (or the Incidents tab if an incident was auto-created) and identify the failing check for the batch (format B-YYYYMMDD-NN).
2. Read the check record from `dq_check_results`: note `check_name`, `check_category`, `table_name`, `column_name`, `status` (FAIL/WARN), `expected_value`, `actual_value`, `threshold_value`, `severity` (INFO/LOW/MEDIUM/HIGH/CRITICAL), and `error_details`. The error details name the offending rows or columns.
3. Map the check name to its incident type using the table below. If `create_incident` is enabled, the pipeline has already created the incident; otherwise L1 decides whether manual creation is warranted (see docs/sop_incident_creation_and_update.md).
4. Follow the mapped runbook for first-level checks, SQL diagnosis, resolution steps, and escalation criteria.
5. Decide the load impact using the policy below — in particular confirm whether the file was quarantined (feed halted) or only records were rejected (feed loaded).

Supporting query (replace `{batch_id}` with the batch identifier, e.g. B-20250601-01):

```sql
-- Which checks failed or warned for this batch, on what table/column?
SELECT check_name, check_category, table_name, column_name, status, severity,
       expected_value, actual_value, threshold_value, error_details, executed_at
FROM dq_check_results
WHERE batch_id = '{batch_id}'
  AND status IN ('FAIL', 'WARN')
ORDER BY severity, executed_at;
```

## Check name to incident type mapping

| Check name | Category | Incident type | Auto incident | Runbook |
|---|---|---|---|---|
| file_arrival_check | COMPLETENESS | FILE_MISSING | Yes | RB001 |
| empty_file_check | COMPLETENESS | EMPTY_FILE | Yes | RB002 |
| checksum_validation | INTEGRITY | CHECKSUM_MISMATCH | Yes | RB003 |
| schema_header_validation | SCHEMA | SCHEMA_DRIFT | Yes | RB004 |
| row_count_check | COMPLETENESS | ROW_COUNT_MISMATCH | Yes | RB005 |
| sla_check | OPERATIONS | SLA_BREACH | Yes | RB009 |
| null_check_mandatory | COMPLETENESS | NULL_VALUES | Yes | RB007 |
| duplicate_record_check | UNIQUENESS | DUPLICATE_RECORDS | Yes | RB006 |
| date_validity_check | VALIDITY | RANGE_VIOLATION | Yes | RB007 |
| numeric_range_check | VALIDITY | RANGE_VIOLATION | Yes | RB007 |
| referential_integrity_check | INTEGRITY | none | No | Investigate below |
| freshness_check | FRESHNESS | FRESHNESS_FAILURE | Yes | RB010 |
| quarantined_file_check | OPERATIONS | none | No | Confirm quarantine cause (RB002/RB003/RB004) |
| rejected_threshold_check | OPERATIONS | none | No | See load impact below; follow RB007 |
| source_to_target_rowcount_recon | RECONCILIATION | ROW_COUNT_MISMATCH | Yes | RB005 |
| source_to_target_aggregate_recon | RECONCILIATION | ROW_COUNT_MISMATCH | Yes | RB005 |
| cross_dataset_emissions_consistency | RECONCILIATION | none | No | Investigate below |

Checks without an auto incident still require triage:

- referential_integrity_check: readings referencing sites absent from the site master. Usually resolved by the next site_master feed; if persistent, escalate to Data Engineering L2 with the orphaned site_ids.
- quarantined_file_check: operational confirmation that a file sits in `data/quarantine`; identify the underlying cause via RB002/RB003/RB004.
- rejected_threshold_check: fires when rejected records exceed 5 percent of the batch. Review `rejection_reason` in staging and follow the RB007 path; create a manual incident if the auto incidents do not cover it.
- cross_dataset_emissions_consistency: WARN-level comparison between energy and carbon feeds; investigate discrepancies with both source owners before they become reconciliation failures.

## Load impact policy

The pipeline enforces `validated_records_only`:

1. Only staging rows with `validation_status` = VALID are loaded into the warehouse (`dim_site`, `fact_energy_emissions`). Rejected rows are never loaded.
2. File-level critical failures — empty file, checksum mismatch, schema drift — quarantine the file and halt that feed's load for the batch. Other feeds in the same batch continue processing.
3. Record-level failures — nulls, range violations, duplicates — reject individual rows while the rest of the feed loads, provided the rejected ratio stays within the 5 percent threshold (`rejected_record_threshold_pct`). Beyond the threshold, `rejected_threshold_check` fails and the batch is flagged.
4. Never load a quarantined file manually or bypass validation to "complete" a batch. The correct fix is a corrected re-delivery from the source system owner, then a pipeline re-run from the Control Room.

## After the fix

1. Re-run the pipeline for the batch from the Control Room once the corrected data or configuration is in place.
2. Confirm the previously failing check now PASSes on the Data Quality tab, and that reconciliation checks pass for the batch.
3. Update the incident work notes and resolve per docs/sop_incident_creation_and_update.md, including verification evidence (query outputs or check results).

## Escalation

Use each runbook's escalation criteria; summary in docs/sop_escalation_matrix.md (P1 immediate; P2 after 240 minutes unresolved, enforced by auto-escalation; P3 after one business day; P4 monitor).
