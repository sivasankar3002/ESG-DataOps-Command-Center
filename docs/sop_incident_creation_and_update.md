# SOP — Incident Creation and Update

## Purpose

Define the ServiceNow-style incident lifecycle on the ESG DataOps Command Center: how incidents are created (automatic and manual), how status transitions and work notes are managed, what resolution notes must contain, what the evidence package includes, and how severity is mapped.

## Incident lifecycle

States: OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED. Reopening is allowed from RESOLVED back to OPEN. CLOSED is terminal.

| Current status | Allowed next statuses | Notes |
|---|---|---|
| OPEN | IN_PROGRESS, RESOLVED | Set IN_PROGRESS as soon as you start working |
| IN_PROGRESS | RESOLVED, OPEN | Back to OPEN if reassigned or reset |
| RESOLVED | CLOSED, OPEN | OPEN = reopen with a justification work note |
| CLOSED | (none) | Terminal; a new issue requires a new incident |

Rules:

- Invalid transitions are rejected by the platform; every status change automatically writes a work note.
- Do not leave an incident OPEN while actively working it — move it to IN_PROGRESS.
- Resolve only when the fix is verified (checks passing, counts reconciled), not when the fix is merely applied.
- Close after the monitoring window (typically the next successful batch for that feed).

## Incident creation

### Automatic creation

The pipeline creates incidents when a configured check fails (`create_incident: true` in `config/data_quality_rules.yaml`) or a task fails. Auto-created incidents include: severity from the mapping below, assignment group ESG DataOps L1, assignee L1 On-call, the matching runbook link, an evidence package, an opening work note from esg-pipeline-bot, and an alert dispatched to the console, email stub and webhook stub channels.

### Manual creation (L1)

Create manually when you observe a problem that produced no auto incident (for example a recurring referential-integrity warning). Minimum required fields:

- incident_type (one of the 12 types), severity (from the mapping table), short_description (what broke, one line), detailed_description (scope: batch, feed, table, row counts), batch_id and run_id when applicable, affected_file / affected_table / affected_check.

## Severity mapping

| Incident type | Severity |
|---|---|
| LOAD_FAILURE | P1 |
| SCHEMA_DRIFT | P1 if a mandatory column is missing, else P2 |
| FILE_MISSING | P2 |
| FILE_CORRUPTED | P2 |
| EMPTY_FILE | P2 |
| CHECKSUM_MISMATCH | P2 |
| ROW_COUNT_MISMATCH | P2 |
| SLA_BREACH | P2 |
| FRESHNESS_FAILURE | P2 |
| NULL_VALUES | P2 if a mandatory column is affected, else P3 |
| DUPLICATE_RECORDS | P3 |
| RANGE_VIOLATION | P3 |

P1 and P2 severities follow the escalation matrix (docs/sop_escalation_matrix.md); P1 escalates immediately.

## Work-note hygiene

Every meaningful action gets a work note, added via the Incidents tab. Rules:

- One note per action: observation, diagnosis step, query run and its result, contact made, fix applied, verification result.
- Include specifics: identifiers (batch_id, incident_id, file_name, record counts), query outcomes, and names of contacted people or roles.
- Never delete or rewrite history; corrections are added as new notes.
- Always add a note when: changing status, reassigning, escalating, requesting re-delivery from a source owner, or re-running the pipeline.
- The note author defaults to L1 Support; use your on-call identity so the audit trail is attributable.

## Resolution-notes requirements

An incident cannot be RESOLVED without resolution notes that state, at minimum:

1. Root cause (what actually failed and why).
2. Scope of impact: affected batch_id(s), feed/dataset, table, and row counts (rejected/missing/loaded).
3. Fix or workaround applied, by whom, and when (timestamps).
4. Verification evidence: which checks now PASS, reconciliation result, row counts tied out.
5. Follow-up items: source-owner actions, pending backfills, monitoring to perform before closure.

Example: "Root cause: ESG-IOT-HUB export truncated energy_consumption_2025-06-01.csv (checksum mismatch, RB003). Impact: batch B-20250601-01, 0 of 214 expected rows loaded. Fix: full re-delivery received 09:12, pipeline re-run 09:15 by L1 On-call. Verification: checksum_validation PASS, row_count_check PASS (214/214), source_to_target_rowcount_recon PASS. Follow-up: source owner investigating transfer job; monitor next 3 deliveries."

## Evidence package

Every incident has an evidence package stored under `evidence/{batch_id}/{incident_id}/`, indexed in the `incident_evidence` table. Contents:

| File | Evidence type | Content |
|---|---|---|
| incident_summary.json | INCIDENT_SUMMARY_JSON | Machine-readable summary: incident fields, severity, affected objects |
| error_log.txt | LOG_FILE | Pipeline error output for the failing task or check |
| failed_rows.csv | FAILED_ROWS_CSV | Rejected/failed records with reasons |
| query_results.json | QUERY_RESULT_JSON | Results of diagnostic queries captured at creation |
| screenshot_placeholder.txt | SCREENSHOT_PLACEHOLDER | Attach the relevant dashboard screenshot here before closure |
| escalation_handoff.md | ESCALATION_HANDOFF_MD | Filled in when escalating to Data Engineering L2 |

L1 responsibilities: verify the package exists and is complete when taking an incident; add the screenshot before resolving; complete escalation_handoff.md before any escalation.

## Updates and escalation mechanics

- Status changes, reassignment, resolution notes, and escalation are performed from the Incidents tab; each update refreshes `updated_at` and writes the corresponding work note(s).
- Escalating sets `escalated_flag`, reassigns the incident to Data Engineering L2, and dispatches an INCIDENT_ESCALATED alert.
- The escalation manager automatically escalates OPEN/IN_PROGRESS incidents older than 240 minutes (`escalation_threshold_minutes`), writing an escalation-manager work note — do not rely on this for P1 incidents.
- Reopening (RESOLVED -> OPEN) requires a justification note stating why the resolution did not hold.
