# RB009 — SLA Breach / Late File

## Incident type

SLA_BREACH

Raised automatically when `sla_check` (category OPERATIONS, severity HIGH) fails: a feed arrived later than expected arrival + SLA hours. SLA deadlines: site_master 06:15 + 2h = 08:15; energy_consumption 06:30 + 4h = 10:30; carbon_emissions 06:40 + 4h = 10:40.

## Severity guidance

P2 (severity mapping: SLA_BREACH -> P2). Auto-created by the pipeline; assigned to **ESG DataOps L1** / **L1 On-call**. Note the distinction: FILE_MISSING (RB001) means the file never arrived; SLA_BREACH means it arrived but too late for the daily pipeline window (the DAG runs ~06:30-07:30).

## Business impact

- The daily pipeline window is missed: the batch either ran without the feed (a data gap for the business date) or must be re-run after arrival, delaying the daily report and downstream consumers.
- Repeated breaches erode confidence in ESG reporting timeliness and can threaten regulatory or disclosure deadlines.
- Late feeds push warehouse freshness toward the 26-hour boundary, risking a follow-on FRESHNESS_FAILURE (RB010).

## First-level checks

1. Control Room: confirm the batch_id and overall health; identify which feed breached its SLA.
2. File Ingestion tab: find the late file; compare `expected_arrival_date` with `received_at`; confirm `file_status` eventually reached PROCESSED (or is still pending a re-run).
3. Data Quality tab: open the `sla_check` FAIL row; note `expected_value` (SLA deadline), `actual_value` (arrival time) and `threshold_value` (sla_hours: 2 for site_master, 4 for the other feeds).
4. Pipeline Runs tab: determine whether the original batch ran without the feed, and whether a re-run was triggered after the late arrival.
5. Incidents tab: open the SLA_BREACH incident; note `created_at` — the 240-minute escalation clock starts there.
6. Overview tab: check the file-arrival KPI and 14-day trend to see whether this feed is chronically late.
7. Daily Report tab: check whether the business date was reported RED or AMBER because of the breach.

## SQL queries to run

Placeholder substitution: `{batch_id}` = batch identifier from the incident (format B-YYYYMMDD-NN); `{dataset}` = one of `site_master`, `energy_consumption`, `carbon_emissions`; `{business_date}` = business date in YYYY-MM-DD form.

```sql
-- Q1: How late was each file in this batch?
SELECT file_name, dataset, expected_arrival_date, received_at,
       ROUND((EXTRACT(EPOCH FROM (received_at - expected_arrival_date)) / 3600.0)::numeric, 2) AS hours_late,
       file_status
FROM file_ingestion_log
WHERE batch_id = '{batch_id}'
ORDER BY hours_late DESC NULLS LAST;

-- Q2: What did sla_check record for the business date?
SELECT check_name, status, severity, expected_value, actual_value, threshold_value, error_details
FROM dq_check_results
WHERE business_date = '{business_date}'
  AND check_name = 'sla_check';

-- Q3: What is the state of the SLA_BREACH incident?
SELECT incident_id, severity, status, short_description, affected_file, escalated_flag, created_at
FROM incident_log
WHERE batch_id = '{batch_id}'
  AND incident_type = 'SLA_BREACH';

-- Q4: Is this feed chronically late (last 7 deliveries)?
SELECT expected_arrival_date, file_name,
       ROUND((EXTRACT(EPOCH FROM (received_at - expected_arrival_date)) / 3600.0)::numeric, 2) AS hours_late
FROM file_ingestion_log
WHERE dataset = '{dataset}'
ORDER BY expected_arrival_date DESC
LIMIT 7;
```

## Expected normal result

- Q1: `received_at` within minutes after the expected arrival (site_master 06:15, energy_consumption 06:30, carbon_emissions 06:40); `hours_late` far below the SLA hours.
- Q2: `sla_check` status PASS for all feeds.
- Q3: no rows returned.
- Q4: consistent, small `hours_late` values across the last 7 business days.

## Possible root causes

Ranked by observed frequency:

- Source batch job overran or was delayed at the source system.
- Transfer or network delay between the source system and the landing zone.
- Pipeline contention: the file arrived on time but was registered late because the sensor or a previous batch was still running.
- Systemic scheduling problem at the source (chronic lateness visible in Q4).

## Resolution steps

1. Compute the actual delay (Q1) and confirm it exceeds the feed's `sla_hours`.
2. Verify whether the file has since been processed: if the batch already re-ran, confirm `file_status` PROCESSED and reconciliation PASS on the Reconciliation tab; if not, trigger a re-run for the batch from the Control Room.
3. Confirm the business date's data is complete in the warehouse after the re-run (row counts, freshness).
4. Log the breach with the source system owner, stating whether it was a one-off or chronic (Q4).
5. For chronic breaches: raise the trend with the source owner and Data Engineering L2 so the feed schedule or the SLA definition is revisited.
6. Resolve the incident documenting the delay, the re-run outcome, and the owner's response.

## Escalation criteria

Escalate to Data Engineering L2 if:

- The feed is chronically late (3 or more breaches in the last 7 business days) — a scheduling fix is needed on the source side.
- The breach cascades: the re-run fails, or freshness breaches the 26-hour policy (follow RB010 as well).
- The incident is unresolved after 240 minutes — auto-escalation applies (OPEN/IN_PROGRESS incidents older than the threshold are reassigned to Data Engineering L2).

## Related dashboard tab

File Ingestion (arrival vs expected times); supporting evidence on Data Quality, Incidents and the Overview trend.

## Related tables

- `file_ingestion_log`
- `dq_check_results` (sla_check)
- `incident_log`
- `job_run_audit` (re-run evidence)
