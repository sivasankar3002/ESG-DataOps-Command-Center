# ESG DataOps Command Center

A full-stack operational dashboard I built to simulate how ESG (Environmental, Social, Governance) batch data pipelines work in production — from file ingestion all the way through to warehouse loading, data quality checks, and incident response.

The idea came from wanting to understand the day-to-day of production support in data engineering: what happens when a file doesn't show up? What if the data has bad checksums or schema changes? How do you track incidents and hand things off between shifts?

![Control room](qa-r5-01-control-room.png)

## What it does

The app models a daily ESG data pipeline that processes energy consumption, carbon emissions, and site master data. It runs through 8 sequential tasks:

1. **Detect incoming files** — checks `data/incoming/` against a manifest of expected feeds
2. **Validate files** — SHA256 checksums, schema validation, row counts
3. **Load to staging** — bulk load with row-level rejection
4. **Run DQ checks** — 17 YAML-configured quality rules
5. **Load warehouse** — transforms staging into a star schema
6. **Reconcile** — row counts and aggregates between source and target
7. **Generate report** — daily ops summary (runs regardless of failures)
8. **Send alerts** — dispatches notifications and runs escalation sweep

When something breaks, the system creates incidents with severity levels (P1-P3), gathers evidence packages, and links to the relevant runbook.

## Screenshots

<details>
<summary>Click to expand all views</summary>

![Overview dashboard](qa-r5-02-overview.png)

![Pipeline runs](qa-r5-03-pipeline.png)

![File ingestion](qa-r5-04-files.png)

![Data quality](qa-r5-05-dq.png)

![Incidents](qa-r5-06-incidents.png)

![Alerts](qa-r5-07-alerts.png)

![Reconciliation](qa-r5-08-recon.png)

![Sites](qa-r5-09-sites.png)

![Runbooks](qa-r5-10-runbooks.png)

![Daily report](qa-r5-11-report.png)

</details>

## Tech stack

- **Next.js 16** + TypeScript
- **Tailwind CSS** for styling
- **Prisma** + SQLite (designed to swap to Postgres/Snowflake)
- **YAML** config for DQ rules, file manifests, and pipeline settings

## Getting started

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## How the pipeline works

The engine (`src/lib/esg/engine.ts`) runs the same task functions that an Airflow DAG would — retries, failure callbacks, context passing, and audit logging are all there. The only difference is the scheduler: here it's an HTTP trigger instead of Airflow's cron. Pointing a real Airflow deployment at these task functions would be a wiring change, not a rewrite.

```bash
# trigger a pipeline run
curl -X POST http://localhost:3000/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"businessDate":"2026-08-20"}'

# check current state
curl http://localhost:3000/api/state
```

Each task run gets recorded in `job_run_audit` with status, duration, and row counts. Batch IDs follow the format `B-YYYYMMDD-NN`.

## The dashboard

The dashboard has 11 tabs — here's what each one is for:

| Tab | What's there |
|-----|-------------|
| Control Room | Generate test data, run the pipeline, trigger failure simulations |
| Overview | Health status (green/amber/red), KPI tiles, 14-day trends, shift handover generation |
| Pipeline Runs | Per-task audit trail, DAG dependency graph, batch timeline, replay capability |
| File Ingestion | Landing zone view — which files arrived, their checksum status, quarantine reasons |
| Data Quality | All 17 checks per batch with pass/fail/warn, click any row for rule details and history |
| Incidents | Full incident queue with lifecycle management, work notes, evidence, escalation timers |
| Alerts | Alert console with severity filters, bulk ack, configurable subscriptions |
| Reconciliation | Source-to-target comparisons with tolerance deltas |
| Sites | Per-site energy/emissions analytics from the star schema |
| Runbooks | RB001-RB010 and 6 SOPs rendered in-app with SQL checks |
| Daily Report | The daily ops summary with health computation and CSV/MD download |

**Keyboard shortcuts:** `?` for help, `Ctrl+K` for command palette, `r` to refresh, `1-9`/`0`/`d` to switch tabs, `j`/`k` to navigate incidents.

## Failure simulations

The fun part — you can simulate 11 different failure scenarios and watch the pipeline handle them:

| Scenario | What breaks | Expected incident |
|----------|------------|-------------------|
| `missing_file` | A mandatory feed doesn't arrive | FILE_MISSING (P2) |
| `empty_file` | File has headers but no data | EMPTY_FILE (P2) |
| `checksum_mismatch` | SHA256 doesn't match the manifest | CHECKSUM_MISMATCH (P2) |
| `schema_drift` | Column names changed | SCHEMA_DRIFT (P1/P2) |
| `duplicates` | Primary key violations | DUPLICATE_RECORDS (P3) |
| `null_values` | Nulls in mandatory fields | NULL_VALUES (P2/P3) |
| `sla_breach` | File arrived after the SLA window | SLA_BREACH (P2) |
| `load_failure` | Corrupt row crashes the loader | LOAD_FAILURE (P1) |
| `row_count_mismatch` | Staging vs fact counts don't match | ROW_COUNT_MISMATCH (P2) |
| `freshness_failure` | No data for recent business dates | FRESHNESS_FAILURE (P2) |
| `success` | Nothing — clean run baseline | None |

```bash
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"scenario":"checksum_mismatch"}'
```

Each simulation creates the failure condition, runs the full pipeline, and verifies the right incident was raised.

## Evidence packages

When an incident fires, the system gathers an evidence package under `evidence/{batch_id}/{incident_id}/`:

- `incident_summary.json` — structured incident record
- `error_log.txt` — full log lines for the run
- `failed_rows.csv` — the rejected records
- `query_results.json` — first-level SQL check results
- `escalation_handoff.md` — impact assessment and next steps

This is meant to mirror what you'd actually hand to an L2 engineer when escalating.

## Role-based access

Three roles with different permissions:

- **Viewer** — read-only access to everything
- **L1 Operator** — can run pipelines, manage incidents, ack alerts
- **L2 Engineer** — full access including seed/reset

The role is enforced server-side on every mutating API route (returns 403 if you don't have permission). You can switch roles from the header to try each persona.

## Project structure

```
config/                  # YAML config (DQ rules, file manifest, settings)
data/                    # incoming / processed / quarantine landing zones
db/                      # SQLite database
docs/                    # runbooks (RB001-RB010) and SOPs
evidence/                # incident evidence packages
logs/                    # app logs and metrics
prisma/                  # database schema
reports/                 # generated daily ops reports
src/
  app/                   # Next.js pages and API routes
  components/dashboard/  # all the dashboard tab components
  lib/esg/               # core engine, ingestion, ETL, DQ, incidents, etc.
tests/                   # runtime build and container tests
```

## What I'd do next

- Hook it up to a real Airflow instance (the task functions are already isolated)
- Swap SQLite for Postgres or Snowflake
- Add real Slack/PagerDuty alert channels instead of the stubs
- Proper SSO instead of the local role switcher
- Column-level data lineage with something like OpenLineage
