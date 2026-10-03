const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  seed: () => req<{ seeded: number }>("/seed", { method: "POST" }),
  generatePlan: () => req<{ plan_id: string; plan: any; log: string[] }>("/plan", { method: "POST", body: "{}" }),
  approvePlan: (plan_id: string) => req<{ approved: boolean }>("/plan", { method: "POST", body: JSON.stringify({ approve: true, plan_id }) }),
  dryRun: (rules?: any[], records?: any[]) => req<{ run_id: string; source_count: number; accepted_count: number; rejected_count: number }>("/dry-run", { method: "POST", body: JSON.stringify({ ...(rules ? { rules } : {}), ...(records ? { records } : {}) }) }),
  execute: (run_id?: string, rules?: any[], records?: any[]) => req<{ run: any; resumed: boolean }>("/execute", { method: "POST", body: JSON.stringify({ ...(run_id ? { run_id } : {}), ...(rules ? { rules } : {}), ...(records ? { records } : {}) }) }),
  suggestMapping: (ctx: { target_field: string; target_type?: string; source_fields: string[]; sample_record?: any }) => req<{ transform: string; expression?: string; reasoning: string }>("/suggest-mapping", { method: "POST", body: JSON.stringify(ctx) }),
  reconcile: () => req<{ source_total: number; target_total: number; quarantine_total: number; accounted: number; matched: boolean }>("/reconcile"),
  rollback: (run_id: string) => req<{ rolled_back: boolean }>("/rollback", { method: "POST", body: JSON.stringify({ run_id }) }),
  history: () => req<{ runs: any[] }>("/history"),
  quarantine: (run_id?: string) => req<{ records: QuarantineRecord[] }>(`/quarantine${run_id ? `?run_id=${run_id}` : ""}`),
  plans: () => req<{ plans: any[] }>("/plans"),
  validateSchema: (body: any) => req<{ valid: boolean; migratable: boolean; errors: string[]; issues: string[] }>("/validate-schema", { method: "POST", body: JSON.stringify(body) }),
  exampleDb: () => req<{ total: number; rows: any[] }>("/example-db"),
};

export interface QuarantineRecord {
  id: number;
  run_id: string;
  source_record_json: string;
  field_errors_json: string;
  created_at: string;
}
