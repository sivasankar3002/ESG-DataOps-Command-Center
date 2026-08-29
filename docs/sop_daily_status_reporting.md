# SOP — Daily Status Reporting

## Purpose

Define how the daily operations report is produced, what each field means, and how overall health (GREEN/AMBER/RED) is derived. The report is the factual basis for step 7 of the daily monitoring SOP (docs/sop_daily_monitoring.md).

## How the report is produced

1. The final task of the `esg_daily_ingestion` DAG, `generate_ops_report_task`, triggers the reporting module for the business date.
2. The module gathers statistics for the business date from the operational tables: `file_ingestion_log` (file counters), `job_run_audit` (job counters), `dq_check_results` (check counters and reconciliation status), and `incident_log` (open, P1, P2 incident counts).
3. It upserts a single row per report_date into the `daily_ops_report` table (re-running refreshes the same row).
4. It writes two artefacts under `reports/`:
   - `reports/daily_ops_report_YYYY-MM-DD.md` — human-readable markdown report (executive summary plus metric tables).
   - `reports/daily_ops_report_YYYY-MM-DD.csv` — machine-readable single-row CSV for archival and trending.
5. Both artefacts are also viewable/downloadable on the Daily Report tab of the operational dashboard. If late fixes change the numbers during the day, L1 regenerates the report (Control Room re-run or the Daily Report tab) so the published status reflects reality.

## Field definitions

| Field | Definition |
|---|---|
| report_date | Business date the report covers (YYYY-MM-DD) |
| files_expected | Number of mandatory feeds expected for the day (3: site_master, energy_consumption, carbon_emissions) |
| files_received | Distinct datasets with a file logged for the business date |
| files_quarantined | Files with file_status QUARANTINED for the business date |
| jobs_executed | job_run_audit rows for the day (all tasks of all runs) |
| jobs_succeeded | Jobs with status SUCCESS |
| jobs_failed | Jobs with status FAILED |
| dq_checks_executed | dq_check_results rows for the business date |
| dq_checks_passed | Checks with status PASS |
| dq_checks_failed | Checks with status FAIL |
| open_incidents | Incidents for the day with status OPEN or IN_PROGRESS |
| p1_incidents | Open incidents with severity P1 |
| p2_incidents | Open incidents with severity P2 |
| reconciliation_status | source_to_target_rowcount_recon outcome for the day: PASS, FAIL, or NO_DATA (no recon checks executed yet) |
| overall_health | GREEN, AMBER, or RED per the logic below |

## Health logic

Evaluated in order; the first matching rule wins.

| Health | Condition (any of) |
|---|---|
| RED | A failed load (jobs_failed > 0), or any P1 incident open, or any P2 incident open, or reconciliation_status = FAIL, or a mandatory file missing (files_received < files_expected) |
| AMBER | Not RED, and any of: non-critical validation failures (dq_checks_failed > 0 or WARN-level checks), one or more open P3 incidents, or files_quarantined > 0 |
| GREEN | Not RED and not AMBER: no failed jobs, no P1/P2 incidents, reconciliation pass, all mandatory files received |

Interpretation for the status update:

- GREEN — routine day; state the headline numbers and close.
- AMBER — name the failing checks or P3 incidents, the runbook in use, and the expected resolution time.
- RED — lead with the P1/P2 incident or failed load, the runbook in use, escalation status, and the recovery plan; stakeholders need this first.

## Review and distribution

1. After the DAG window (by ~07:50), open the Daily Report tab and review the generated report.
2. Cross-check the rating against what you observed in daily monitoring steps 1-6; investigate any mismatch before publishing (for example, a GREEN rating while an incident is still open usually means the incident belongs to the previous business date).
3. Regenerate the report if late fixes changed the facts (a re-run after a late file, a resolved incident).
4. Publish the daily status update by 08:30: overall health, feed/jobs/checks summary, open incidents with next actions and escalation deadlines, reconciliation and freshness status, and handover items. Attach or link the markdown report; archive the CSV under reports/.
5. In the status update, always reference evidence (dashboard tab, report path, incident_id) rather than unqualified statements.

## Trending

- The CSV artefacts accumulate under `reports/`; use them (or the Daily Report tab trend) to spot recurring patterns: chronic late feeds, repeated quarantines, rising rejected-record ratios.
- Recurring AMBER patterns that never escalate still deserve a source-owner conversation — raise them proactively in the daily update.

## Related documents

- docs/sop_daily_monitoring.md — the checklist that feeds the status update
- docs/sop_incident_creation_and_update.md — incident counts and states used by the report
- docs/runbooks/ (RB001-RB010) — actions behind every RED/AMBER cause
