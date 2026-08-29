# SOP — File Arrival Check

## Purpose

Define how ESG DataOps L1 verifies that all expected daily feeds landed in the landing zone, how to interpret `file_ingestion_log` statuses, and what to do when a file is missing or late. Performed as step 1 of the daily monitoring SOP (docs/sop_daily_monitoring.md) and whenever a file-related alert fires.

## Expected daily feeds

All feeds land in `data/incoming` (simulated SFTP/S3 drop zone) as CSV with a manifest sidecar `file.csv.manifest.json` containing `expected_rows` and `checksum_sha256`.

| Dataset | File pattern | Source system | Expected arrival | SLA | SLA deadline | Mandatory |
|---|---|---|---|---|---|---|
| site_master | site_master_YYYY-MM-DD.csv | FACILITIES-MDM | 06:15 | 2 hours | 08:15 | Yes |
| energy_consumption | energy_consumption_YYYY-MM-DD.csv | ESG-IOT-HUB | 06:30 | 4 hours | 10:30 | Yes |
| carbon_emissions | carbon_emissions_YYYY-MM-DD.csv | CARBON-LEDGER-API | 06:40 | 4 hours | 10:40 | Yes |

The DAG `esg_daily_ingestion` becomes eligible at 06:30 and typically finishes between 06:30 and 07:30; batch_id format is B-YYYYMMDD-NN.

## How to verify expected feeds

1. Open the File Ingestion tab on the operational dashboard and set the view to the current business date.
2. Confirm each of the three feeds above appears with a file entry; the count of received files must equal files expected (3).
3. For each file, confirm the manifest sidecar is present next to the data file in `data/incoming` (the sensor expects both).
4. Confirm the transition through the normal lifecycle (see table below) ends at PROCESSED, and that the file moved out of `data/incoming` into `data/processed`.
5. Cross-check counts: files expected vs files received on the Overview tab, and `files_expected` / `files_received` / `files_quarantined` on the Daily Report tab.

Supporting query (replace `{business_date}` with the date in YYYY-MM-DD form):

```sql
-- Which feeds arrived for the business date, when, and in what state?
SELECT file_name, dataset, expected_arrival_date, received_at, file_size_bytes,
       checksum_status, file_status, zone, error_message
FROM file_ingestion_log
WHERE expected_arrival_date >= '{business_date} 00:00:00'
  AND expected_arrival_date <  '{business_date} 23:59:59'
ORDER BY dataset;
```

## Interpreting file_ingestion_log statuses

### file_status lifecycle

| Status | Meaning | L1 action |
|---|---|---|
| RECEIVED | File detected in data/incoming | None; wait for validation |
| VALIDATING | Header/manifest/checksum checks in progress | None; transient |
| VALIDATED | All file-level checks passed | None; load follows |
| QUARANTINED | File-level check failed; file moved to data/quarantine; the feed's load is halted | Identify the failing check; follow RB002/RB003/RB004 |
| PROCESSING | Load into staging/warehouse in progress | None; transient |
| PROCESSED | Loaded successfully; file archived to data/processed | None; healthy end state |
| FAILED | Processing ended in failure | Check error_message; follow RB008 |

### zone values

| Zone | Meaning |
|---|---|
| INCOMING | Landing zone (data/incoming) |
| QUARANTINE | Held for defect review (data/quarantine) |
| PROCESSED | Archived after successful load (data/processed) |

### checksum_status values

| Value | Meaning |
|---|---|
| PENDING | Not yet computed |
| VALID | Computed SHA-256 matches the manifest checksum_sha256 |
| INVALID | Mismatch — file quarantined; follow RB003 |
| SKIPPED | No manifest present; checksum not applicable |

## When a file is missing

1. Confirm absence: check the File Ingestion tab and list `data/incoming` — a misnamed file (not matching `dataset_YYYY-MM-DD.csv`) will not be sensed.
2. Check whether the manifest arrived without the data file, or vice versa.
3. If truly missing, a FILE_MISSING incident (P2) is auto-created by `file_arrival_check`; follow RB001 — Missing File.
4. Contact the source system owner (see docs/sop_escalation_matrix.md) and request re-delivery while the SLA window is still open.
5. When the file lands, re-run the pipeline for the batch from the Control Room and verify the feed reaches PROCESSED.

## When a file is late

1. Compare `received_at` against the expected arrival (06:15 / 06:30 / 06:40). Within the SLA window, lateness alone is a warning, not an incident.
2. If arrival exceeds expected arrival + SLA hours (08:15 / 10:30 / 10:40), `sla_check` raises an SLA_BREACH incident (P2); follow RB009 — SLA Breach / Late File.
3. If the daily batch already ran without the feed, trigger a re-run after arrival so the business date is backfilled the same day.
4. Track repeated lateness on the Overview trend; chronic breaches (3+ in 7 days) go to the source owner and Data Engineering L2.

## Escalation

- Missing or late file past its SLA deadline with no source-owner confirmation: escalate per docs/sop_escalation_matrix.md (P2 path; auto-escalation at 240 minutes unresolved).
- Two consecutive days without a feed: treat as systemic and escalate immediately.

## Related documents

- RB001 — Missing File; RB009 — SLA Breach / Late File; RB002/RB003/RB004 for quarantined-file causes
- docs/sop_daily_monitoring.md (step 1); docs/sop_escalation_matrix.md
