# SOP — Escalation Matrix

## Purpose

Define when ESG DataOps L1 escalates incidents, to whom, and through which channel. Severity definitions come from the incident severity mapping (docs/sop_incident_creation_and_update.md); the auto-escalation threshold is 240 minutes.

## Severity escalation matrix

| Severity | Typical incident types | Escalation trigger | Escalate to | Channel |
|---|---|---|---|---|
| P1 | LOAD_FAILURE; SCHEMA_DRIFT with a mandatory column missing | Immediately on detection — never wait | Data Engineering L2 + on-call manager | Alert (console, email stub, webhook stub) plus direct contact; in production, phone/page |
| P2 | FILE_MISSING, FILE_CORRUPTED, EMPTY_FILE, CHECKSUM_MISMATCH, SCHEMA_DRIFT (optional column), ROW_COUNT_MISMATCH, NULL_VALUES (mandatory column), SLA_BREACH, FRESHNESS_FAILURE | 240 minutes unresolved (auto-escalation) or earlier if L1 steps are exhausted | Data Engineering L2 | Alert + work note; escalation_handoff.md completed |
| P3 | DUPLICATE_RECORDS, NULL_VALUES (optional column), RANGE_VIOLATION | 1 business day unresolved | Data Engineering L2 | Alert + work note |
| P4 | Monitoring-only and informational findings (for example cross_dataset_emissions_consistency WARN) | No escalation; monitor | — | Noted in the daily report |

Notes:

- The 240-minute clock starts at incident `created_at`. The escalation manager sweeps OPEN/IN_PROGRESS incidents with `escalated_flag` = false and auto-escalates them: it sets the flag, reassigns to Data Engineering L2, writes an escalation-manager work note, and dispatches an INCIDENT_ESCALATED alert.
- Auto-escalation is a backstop. P1 incidents must be escalated by the on-call engineer the moment they are detected, in parallel with first-level checks.
- P2/P3 incidents should be escalated early — with a complete handoff — whenever L1 runbook steps are exhausted, even before the threshold.

## Contact roles

| Role | Responsibility | Engaged for |
|---|---|---|
| L1 On-call | First response, runbook execution, incident updates, evidence collection | All incidents (default assignee) |
| ESG DataOps L1 (assignment group) | Queue ownership, shift handover, daily monitoring | All incidents; group visibility |
| Data Engineering L2 | Pipeline/platform fixes, config/data_quality_rules.yaml changes, warehouse remediation, backfills | All escalations |
| On-call manager | Management awareness, incident command for P1 | P1 incidents |
| ESG-IOT-HUB owner (source system) | energy_consumption feed production and re-delivery | Feed defects for energy_consumption |
| CARBON-LEDGER-API owner (source system) | carbon_emissions feed production and re-delivery | Feed defects for carbon_emissions |
| FACILITIES-MDM owner (source system) | site_master feed production and re-delivery | Feed defects for site_master |

This deployment simulates contacts as role names; in production, substitute the on-call rota and contact directory (phone, paging, group inbox) without changing the matrix logic.

## Manual escalation procedure

1. Confirm the trigger: P1 immediate, P2 past (or about to pass) 240 minutes, P3 past one business day, or L1 runbook steps exhausted.
2. Add a work note summarizing everything done so far: runbook followed, queries run and results, contacts made, current hypothesis.
3. Complete `escalation_handoff.md` in the evidence package (`evidence/{batch_id}/{incident_id}/`). It must contain: incident summary, business impact, timeline of actions, diagnostic evidence (query_results.json, failed_rows.csv pointers), current root-cause hypothesis, what L2 is asked to do, and the next scheduled pipeline event that will be affected.
4. Escalate from the Incidents tab: this sets `escalated_flag`, reassigns to Data Engineering L2, and dispatches the INCIDENT_ESCALATED alert.
5. For P1, additionally notify the on-call manager directly and keep the incident IN_PROGRESS with your name on the work notes until L2 confirms ownership.
6. Monitor the alert acknowledgment; follow up if no response within the expected P1/P2 response window.

## Source-system engagement (before escalation)

For feed-related incidents (missing, late, empty, corrupted files), contact the source-system owner first — most such incidents are resolved by re-delivery without Data Engineering involvement:

- State the feed, business date, file name, what the pipeline observed, and what you need (re-delivery with a fresh manifest).
- Record the contact and response in a work note.
- Escalate to Data Engineering L2 only if the source owner cannot deliver, the re-delivery fails the same check, or the defect is platform-side.

## Related documents

- docs/sop_incident_creation_and_update.md — lifecycle, evidence package, work-note rules
- docs/runbooks/ (RB001-RB010) — per-incident escalation criteria
- docs/sop_daily_monitoring.md — shift routine in which escalations are reviewed
