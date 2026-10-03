# Agentic Data Migration Planner & Reconciliation Workbench

A Cloudflare-native app that plans, dry-runs, executes, reconciles, and rolls back
a data migration from a legacy employee schema to a modern contractor schema —
with an AI agent (Workers AI, llama-3-8b-instruct) designing the mapping via tool calling.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS (shadcn-style components)
- **Backend:** Cloudflare Worker (`src/index.ts`) with CORS for the frontend
- **Database:** Cloudflare D1 (SQLite)
- **AI:** Cloudflare Workers AI (`@cf/meta/llama-3-8b-instruct`) with a strict tool-calling loop, zod-validated output

## Constraints / Domain

- Exactly one source schema (`source_employees`: `emp_id, full_name, dept_code, hire_date, salary`) and one target schema (`target_contractors`: `contractor_uuid, first_name, last_name, department_name, start_date, hourly_rate, status`).
- Max sample size: 1,000 records. Seed data injects ~5% invalid rows to exercise quarantine.
- Allowed transforms (hardcoded in `src/worker/migration-engine.ts`): `split_name`, `map_enum`, `math_divide`, `format_date`, `direct`.

## Project Layout

```
src/
  shared/types.ts          zod schemas + shared types
  db/seed.ts               generates 1,000 mock employees (~5% invalid)
  worker/ai-agent.ts       tool-calling loop, zod validation, saves plan to D1
  worker/migration-engine.ts  transformRecord, runDryRun, executeMigration, reconcile, rollbackRun
  index.ts                 Worker router: /api/seed, /api/plan, /api/dry-run, /api/execute,
                           /api/reconcile, /api/rollback, /api/history, /api/quarantine, /api/plans
  frontend/                React app (App.tsx with 4 tabs, components/ui.tsx, lib/api.ts)
schema.sql                 D1 schema (source_employees + 4 given tables)
wrangler.toml              D1 binding (DB), AI binding (AI), static assets
```

## Setup

```bash
npm install
npx wrangler login
npx wrangler d1 create migration-workbench-db
# copy the database_id into wrangler.toml
npm run d1:schema          # remote
# or: npm run d1:schema:local
```

## Develop

```bash
npx wrangler dev --local   # serves the built frontend + /api/* on :8787
npm run dev                # Vite dev server on :5173, proxies /api to :8787
```

Workflow in the UI: **AI Planner** → Generate Plan → Approve Plan →
**Dry Run & Quarantine** → Run Dry Run → **Execution & Reconciliation** → Execute Migration →
**History & Rollback** → rollback any run with confirmation.

Note: local Workers AI requires `wrangler login` even in local dev, and hits the
real Cloudflare account. If unavailable (or on the free tier rate limit), the
planner falls back to a deterministic plan — or force it by setting
`USE_MOCK_AI = "true"` in `wrangler.toml` (see `.env.example`).

## AI Model

The planner uses **Cloudflare Workers AI** with model
`@cf/meta/llama-3-8b-instruct`, invoked via the `AI` binding in `wrangler.toml`
and implemented in `src/worker/ai-agent.ts`. It runs a tool-calling loop
(`inspect_source_schema`, `inspect_target_schema`, `validate_mapping`,
`assess_risk`) and its JSON output is validated with zod before being saved to
D1. On any AI/auth/rate-limit failure it falls back to a hardcoded valid plan.
Set `USE_MOCK_AI=true` to skip live calls entirely.

## Deploy

```bash
npm run deploy             # vite build + wrangler deploy
```

For a pure Cloudflare Pages frontend deploy, build with `npm run build`, set the
Pages build output to `dist`, and point the Pages project's API calls at the
deployed Worker URL (or bind it via a service binding / reverse proxy route).

## API Reference

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| POST | `/api/seed` | — | Generate & insert 1,000 employees |
| POST | `/api/plan` | `{}` or `{approve, plan_id}` | Run AI planner / approve plan |
| POST | `/api/dry-run` | `{run_id?}` | Transform 1,000 rows in memory, quarantine failures |
| POST | `/api/execute` | `{run_id?, plan_id?}` | Idempotent execute; same run_id resumes |
| GET  | `/api/reconcile` | — | Source vs target + quarantine (latest run) |
| POST | `/api/rollback` | `{run_id}` | Atomic rollback of a run |
| GET  | `/api/history` | — | All migration runs |
| GET  | `/api/quarantine?run_id=` | — | Quarantine rows |
| GET  | `/api/plans` | — | All saved plans |

## Typecheck & Build

```bash
npm run typecheck
npm run build
```
