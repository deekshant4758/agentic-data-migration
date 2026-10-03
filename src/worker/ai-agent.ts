import { migrationPlanSchema, MigrationPlan } from "../shared/types";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS?: Fetcher;
  USE_MOCK_AI?: string;
}

const TOOLS = [
  {
    name: "inspect_source_schema",
    description: "Return the legacy employee source schema and a sample row.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_target_schema",
    description: "Return the modern contractor target schema.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "validate_mapping",
    description: "Validate a proposed mapping rule transform names against allowed transformations.",
    parameters: {
      type: "object",
      properties: { transform: { type: "string" } },
      required: ["transform"],
    },
  },
  {
    name: "assess_risk",
    description: "Assess migration risk given a quarantine rejection estimate percentage.",
    parameters: {
      type: "object",
      properties: { estimated_rejection_pct: { type: "number" } },
      required: ["estimated_rejection_pct"],
    },
  },
];

async function executeTool(name: string, args: any, env: Env): Promise<string> {
  switch (name) {
    case "inspect_source_schema": {
      const sample = await env.DB.prepare("SELECT * FROM source_employees LIMIT 1").first();
      return JSON.stringify({
        schema: { emp_id: "int", full_name: "string", dept_code: "string", hire_date: "string", salary: "float" },
        sample,
      });
    }
    case "inspect_target_schema":
      return JSON.stringify({
        schema: { contractor_uuid: "uuid", first_name: "string", last_name: "string", department_name: "string", start_date: "ISO date", hourly_rate: "float", status: "string" },
      });
    case "validate_mapping": {
      const allowed = ["split_name", "map_enum", "math_divide", "format_date", "direct"];
      return JSON.stringify({ valid: allowed.includes(args?.transform), allowed });
    }
    case "assess_risk": {
      const pct = Number(args?.estimated_rejection_pct ?? 0);
      const level = pct < 3 ? "low" : pct < 10 ? "medium" : "high";
      return JSON.stringify({ level, estimated_rejection_pct: pct });
    }
    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}

function buildFallbackPlan(): MigrationPlan {
  return {
    source_schema: "legacy_employee",
    target_schema: "modern_contractor",
    mappings: [
      { source_field: "full_name", target_field: "first_name", transform: "split_name" },
      { source_field: "full_name", target_field: "last_name", transform: "split_name" },
      { source_field: "dept_code", target_field: "department_name", transform: "map_enum" },
      { source_field: "salary", target_field: "hourly_rate", transform: "math_divide", params: { divisor: 2080 } },
      { source_field: "hire_date", target_field: "start_date", transform: "format_date" },
    ],
    risk_assessment: "medium",
    notes: "Fallback deterministic plan (AI unavailable or mock mode enabled).",
    clarification_questions: ["Should inactive employees be flagged for archival before migration?"],
  };
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export async function runPlannerAgent(env: Env, plannerLog: string[]): Promise<MigrationPlan> {
  if (env.USE_MOCK_AI === "true") {
    plannerLog.push("Mock mode: returning deterministic plan.");
    return buildFallbackPlan();
  }

  const system = `You are a data migration planner. Use the provided tools to inspect schemas, validate each transform, then assess risk.
Finally, respond with ONLY a strict JSON object matching this shape:
{"source_schema":"legacy_employee","target_schema":"modern_contractor","mappings":[{"source_field":"full_name","target_field":"first_name","transform":"split_name"}],"risk_assessment":"low|medium|high","notes":"...","clarification_questions":["..."]}
Allowed transforms: split_name, map_enum, math_divide, format_date, direct.`;

  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: "Plan the migration from legacy employees to modern contractors." },
  ];

  try {
    for (let round = 0; round < 6; round++) {
      const response: any = await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages, tools: TOOLS });
      const toolCalls = response?.tool_calls ?? response?.response?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          const name = call.name ?? call.function?.name;
          const args = call.arguments ?? call.function?.arguments ?? {};
          plannerLog.push(`tool_call: ${name}(${JSON.stringify(args)})`);
          const result = await executeTool(name, typeof args === "string" ? JSON.parse(args) : args, env);
          plannerLog.push(`tool_result: ${result.slice(0, 200)}`);
          messages.push({ role: "assistant", content: `Calling tool ${name}` });
          messages.push({ role: "tool", name, content: result });
        }
        continue;
      }

      const text: string = response?.response ?? response?.result?.response ?? "";
      plannerLog.push(`ai_response: ${text.slice(0, 300)}`);
      const jsonText = extractJson(text);
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        const validated = migrationPlanSchema.safeParse(parsed);
        if (validated.success) return validated.data;
        plannerLog.push(`zod_error: ${validated.error.message}`);
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "user", content: "Your JSON did not match the required schema. Reply with only corrected JSON." });
        continue;
      }
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: "Reply with ONLY the strict JSON migration plan now." });
    }
    plannerLog.push("Falling back to deterministic plan after max rounds.");
    return buildFallbackPlan();
  } catch (err: any) {
    plannerLog.push(`ai_error: ${err?.message ?? String(err)}. Using fallback plan.`);
    return buildFallbackPlan();
  }
}

export async function generateAndSavePlan(env: Env): Promise<{ planId: string; plan: MigrationPlan; log: string[] }> {
  const log: string[] = [];
  const plan = await runPlannerAgent(env, log);
  const planId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO migration_plans (plan_id, version, source_schema, target_schema, mapping_rules, status) VALUES (?, 1, ?, ?, ?, 'draft')"
  ).bind(planId, plan.source_schema, plan.target_schema, JSON.stringify(plan.mappings)).run();
  return { planId, plan, log };
}

export async function approvePlan(env: Env, planId: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE migration_plans SET status = 'approved', approved_at = ? WHERE plan_id = ?").bind(new Date().toISOString(), planId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Per-field "Magic Fix": suggest a rule or expr-eval expression for ONE target field. */
export async function suggestMappingForField(
  env: Env,
  ctx: { target_field: string; target_type?: string; source_fields: string[]; sample_record?: any }
): Promise<{ transform: string; expression?: string; reasoning: string }> {
  // Heuristic fast path — no AI call needed for obvious cases.
  const tf = ctx.target_field.toLowerCase();
  const sources = ctx.source_fields.map((s) => s.toLowerCase());
  if (tf.includes("first") || tf.includes("last")) {
    const nameSrc = ctx.source_fields.find((s) => s.toLowerCase().includes("name"));
    if (nameSrc) return { transform: "split_name", reasoning: `Split "${nameSrc}" into name parts.` };
  }
  if (tf.includes("rate") || tf.includes("hourly")) {
    const sal = ctx.source_fields.find((s) => s.toLowerCase().includes("salary"));
    if (sal) return { transform: "math_divide", expression: `${sal} / 2080`, reasoning: `Divide "${sal}" by 2080 working hours.` };
  }
  if (tf.includes("date")) {
    const d = ctx.source_fields.find((s) => s.toLowerCase().includes("date"));
    if (d) return { transform: "format_date", reasoning: `Reformat "${d}" to ISO 8601.` };
  }
  if (tf.includes("department")) {
    const dep = ctx.source_fields.find((s) => s.toLowerCase().includes("dept"));
    if (dep) return { transform: "map_enum", reasoning: `Map "${dep}" codes to department names.` };
  }

  // Fallback: ask the AI for an expr-eval expression, else direct_map.
  try {
    const response: any = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "system", content: "You suggest a single expr-eval expression (variables are source field names) that computes the target field. Reply with only the expression." },
        { role: "user", content: `Target field: ${ctx.target_field} (${ctx.target_type ?? "string"}). Source fields: ${ctx.source_fields.join(", ")}. Example record: ${JSON.stringify(ctx.sample_record ?? {})}.` },
      ],
    });
    const text: string = (response?.response ?? "").trim();
    if (text && text.length < 200 && !text.includes("{")) {
      return { transform: "expression", expression: text.replace(/^`|`$/g, ""), reasoning: "AI-suggested expression." };
    }
  } catch {
    /* fall through */
  }
  const sameName = ctx.source_fields.find((s) => s.toLowerCase() === tf);
  if (sameName) return { transform: "direct_map", reasoning: `Direct copy from "${sameName}".` };
  const guess = ctx.source_fields.find((s) => tf.includes(s.toLowerCase()) || s.toLowerCase().includes(tf));
  return guess ? { transform: "direct_map", reasoning: `Closest match: copy from "${guess}".` } : { transform: "skip", reasoning: "No obvious source field — mark as Skip/Null." };
}
