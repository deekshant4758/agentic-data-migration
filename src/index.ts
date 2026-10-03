import { seedDatabase } from "./db/seed";
import { approvePlan, generateAndSavePlan, suggestMappingForField } from "./worker/ai-agent";
import { executeMigration, reconcile, rollbackRun, runDryRun } from "./worker/migration-engine";
import { schemaValidationInputSchema, validateSchemas } from "./worker/schema-validator";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS?: Fetcher;
  USE_MOCK_AI?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function latestPlanId(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT plan_id FROM migration_plans WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1").first<{ plan_id: string }>();
  if (row) return row.plan_id;
  const any = await env.DB.prepare("SELECT plan_id FROM migration_plans ORDER BY created_at DESC LIMIT 1").first<{ plan_id: string }>();
  return any?.plan_id ?? null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/seed" && request.method === "POST") {
        const count = await seedDatabase(env.DB);
        return json({ seeded: count });
      }

      if (path === "/api/plan" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { approve?: boolean; plan_id?: string };
        if (body.approve && body.plan_id) {
          const ok = await approvePlan(env, body.plan_id);
          return json({ approved: ok });
        }
        const { planId, plan, log } = await generateAndSavePlan(env);
        return json({ plan_id: planId, plan, log });
      }

      if (path === "/api/dry-run" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { run_id?: string; rules?: any[]; records?: any[] };
        const runId = body.run_id ?? `dryrun-${crypto.randomUUID()}`;
        const result = await runDryRun(env.DB, runId, body.rules, body.records);
        return json({ run_id: runId, ...result });
      }

      if (path === "/api/execute" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { run_id?: string; plan_id?: string; rules?: any[]; records?: any[] };
        const runId = body.run_id ?? crypto.randomUUID();
        const planId = body.plan_id ?? (await latestPlanId(env)) ?? "unplanned";
        const result = await executeMigration(env.DB, planId, runId, body.rules, body.records);
        return json(result);
      }

      if (path === "/api/reconcile" && request.method === "GET") {
        return json(await reconcile(env.DB));
      }

      if (path === "/api/rollback" && request.method === "POST") {
        const body = await request.json() as { run_id: string };
        if (!body.run_id) return json({ error: "run_id required" }, 400);
        return json(await rollbackRun(env.DB, body.run_id));
      }

      if (path === "/api/history" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM migration_runs ORDER BY started_at DESC").all();
        return json({ runs: results ?? [] });
      }

      if (path === "/api/quarantine" && request.method === "GET") {
        const runId = url.searchParams.get("run_id");
        const q = runId
          ? await env.DB.prepare("SELECT * FROM quarantine_records WHERE run_id = ? ORDER BY id LIMIT 500").bind(runId).all()
          : await env.DB.prepare("SELECT * FROM quarantine_records ORDER BY id DESC LIMIT 500").all();
        return json({ records: q.results ?? [] });
      }

      if (path === "/api/plans" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM migration_plans ORDER BY created_at DESC").all();
        return json({ plans: results ?? [] });
      }

      if (path === "/api/validate-schema" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const parsed = schemaValidationInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ valid: false, migratable: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), issues: [] }, 200);
        }
        return json(validateSchemas(parsed.data));
      }

      if (path === "/api/suggest-mapping" && request.method === "POST") {
        const body = await request.json() as any;
        if (!body.target_field) return json({ error: "target_field required" }, 400);
        return json(await suggestMappingForField(env, body));
      }

      if (path === "/api/example-db" && request.method === "GET") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM source_employees").first<{ c: number }>();
        const { results } = await env.DB.prepare("SELECT * FROM source_employees ORDER BY emp_id LIMIT 25").all();
        return json({ total: count?.c ?? 0, rows: results ?? [] });
      }

      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      return json({ error: err?.message ?? "Internal error" }, 500);
    }
  },
};
