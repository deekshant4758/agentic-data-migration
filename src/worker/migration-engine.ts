import { DEPT_CODE_MAP, FieldError, MappingRule, SourceEmployee, TargetContractor } from "../shared/types";
import { Parser } from "expr-eval";

export const HARDCODED_RULES: MappingRule[] = [
  { source_field: "full_name", target_field: "first_name", transform: "split_name" },
  { source_field: "full_name", target_field: "last_name", transform: "split_name" },
  { source_field: "dept_code", target_field: "department_name", transform: "map_enum" },
  { source_field: "salary", target_field: "hourly_rate", transform: "math_divide", params: { divisor: 2080 } },
  { source_field: "hire_date", target_field: "start_date", transform: "format_date" },
];

// Deterministic UUID-ish contractor id derived from emp_id so re-executions are idempotent.
function contractorUuidFor(empId: number): string {
  const hex = empId.toString(16).padStart(10, "0");
  return `00000000-0000-4000-8000-${hex.padStart(12, "0")}`;
}

export function splitName(full: string | null): { first?: string; last?: string; error?: string } {
  if (!full || typeof full !== "string") return { error: "full_name is required" };
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { error: "full_name must contain a first and last name separated by a space" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function mapEnum(code: string | null): { value?: string; error?: string } {
  if (!code) return { error: "dept_code is required" };
  const mapped = DEPT_CODE_MAP[code.toUpperCase()];
  if (!mapped) return { error: `Unknown dept_code: ${code}` };
  return { value: mapped };
}

export function mathDivide(salary: number | null, divisor = 2080): { value?: number; error?: string } {
  if (salary === null || salary === undefined || typeof salary !== "number" || Number.isNaN(salary)) {
    return { error: "salary must be a number" };
  }
  if (salary < 0) return { error: "salary cannot be negative" };
  if (divisor === 0) return { error: "divisor cannot be zero" };
  return { value: Math.round((salary / divisor) * 10000) / 10000 };
}

export function formatDate(raw: string | null): { value?: string; error?: string } {
  if (!raw) return { error: "hire_date is required" };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `hire_date is not a valid date: ${raw}` };
  return { value: d.toISOString().slice(0, 10) };
}

/** Applies all transformations to a source row. Returns transformed fields or the complete field-error list. */
export function transformRecord(rec: SourceEmployee): { out: Omit<TargetContractor, "contractor_uuid" | "migrated_in_run_id"> } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const name = splitName(rec.full_name);
  if (name.error) errors.push({ field: "full_name", error: name.error });
  const dept = mapEnum(rec.dept_code);
  if (dept.error) errors.push({ field: "dept_code", error: dept.error });
  const rate = mathDivide(rec.salary);
  if (rate.error) errors.push({ field: "salary", error: rate.error });
  const date = formatDate(rec.hire_date);
  if (date.error) errors.push({ field: "hire_date", error: date.error });

  if (errors.length > 0) return { errors };
  return {
    out: {
      first_name: name.first!,
      last_name: name.last!,
      department_name: dept.value!,
      start_date: date.value!,
      hourly_rate: rate.value!,
      status: "active",
    },
  };
}

const TARGET_FIELDS = ["contractor_uuid", "first_name", "last_name", "department_name", "start_date", "hourly_rate", "status"] as const;

/** Hybrid mapping engine: applies user/AI rules; direct_map passes values through by name;
 *  unmapped target fields become null instead of failing; only hard data errors (bad date,
 *  negative salary, unknown dept, missing name) reject the record. */
export function transformRecordWithRules(rec: SourceEmployee, rules: MappingRule[]): { out: Omit<TargetContractor, "migrated_in_run_id"> } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const out: Record<string, any> = {};

  for (const rule of rules) {
    const srcVal = (rec as any)[rule.source_field];
    switch (rule.transform) {
      case "direct":
      case "direct_map":
        out[rule.target_field] = srcVal ?? null;
        break;
      case "split_name": {
        const n = splitName(srcVal);
        if (n.error) errors.push({ field: rule.source_field, error: n.error });
        else if (rule.target_field === "last_name") out[rule.target_field] = n.last;
        else out[rule.target_field] = n.first;
        break;
      }
      case "map_enum": {
        const d = mapEnum(srcVal);
        if (d.error) errors.push({ field: rule.source_field, error: d.error });
        else out[rule.target_field] = d.value;
        break;
      }
      case "math_divide": {
        const m = mathDivide(srcVal, rule.params?.divisor ?? 2080);
        if (m.error) errors.push({ field: rule.source_field, error: m.error });
        else out[rule.target_field] = m.value;
        break;
      }
      case "format_date": {
        const f = formatDate(srcVal);
        if (f.error) errors.push({ field: rule.source_field, error: f.error });
        else out[rule.target_field] = f.value;
        break;
      }
      case "expression": {
        try {
          const parser = new Parser();
          const expr = parser.parse(String(rule.params?.expression ?? ""));
          out[rule.target_field] = expr.evaluate(rec as any) ?? null;
        } catch (e: any) {
          errors.push({ field: rule.source_field, error: `Expression error: ${e.message}` });
        }
        break;
      }
      case "skip":
        out[rule.target_field] = null;
        break;
    }
  }

  // Unmapped target fields are set to null gracefully rather than failing the record.
  for (const tf of TARGET_FIELDS) {
    if (!(tf in out)) out[tf] = null;
  }

  if (errors.length > 0) return { errors };

  // contractor_uuid must never be null — derive deterministically from emp_id.
  if (!out.contractor_uuid) out.contractor_uuid = contractorUuidFor(rec.emp_id);
  if (!out.status) out.status = "active";

  return { out: out as Omit<TargetContractor, "migrated_in_run_id"> };
}

export async function runDryRun(db: D1Database, runId: string, rules?: MappingRule[], records?: SourceEmployee[]) {
  await db.prepare("DELETE FROM quarantine_records WHERE run_id = ?").bind(runId).run();
  const rows = records ?? (await db.prepare("SELECT * FROM source_employees ORDER BY emp_id").all<SourceEmployee>()).results ?? [];
  let accepted = 0;
  let rejected = 0;
  const quarantineStmts: D1PreparedStatement[] = [];
  for (const rec of rows) {
    const t = rules ? transformRecordWithRules(rec, rules) : transformRecord(rec);
    if ("errors" in t) {
      rejected++;
      quarantineStmts.push(
        db.prepare("INSERT INTO quarantine_records (run_id, source_record_json, field_errors_json) VALUES (?, ?, ?)").bind(
          runId, JSON.stringify(rec), JSON.stringify(t.errors)
        )
      );
    } else {
      accepted++;
    }
  }
  for (let i = 0; i < quarantineStmts.length; i += 50) {
    await db.batch(quarantineStmts.slice(i, i + 50));
  }
  return { source_count: rows.length, accepted_count: accepted, rejected_count: rejected };
}

export async function executeMigration(db: D1Database, planId: string, runId: string, rules?: MappingRule[], records?: SourceEmployee[]) {
  // Idempotency: return existing run if present.
  const existing = await db.prepare("SELECT * FROM migration_runs WHERE run_id = ?").bind(runId).first();
  if (existing) {
    await db.prepare("UPDATE migration_runs SET retries = retries + 1 WHERE run_id = ?").bind(runId).run();
    return { run: existing, resumed: true };
  }

  const started = new Date().toISOString();
  const rows = records ?? (await db.prepare("SELECT * FROM source_employees ORDER BY emp_id").all<SourceEmployee>()).results ?? [];
  let accepted = 0;
  let rejected = 0;
  const insertStmts: D1PreparedStatement[] = [];
  const qStmts: D1PreparedStatement[] = [];

  await db.prepare(
    "INSERT INTO migration_runs (run_id, plan_id, started_at, status, source_count, accepted_count, rejected_count) VALUES (?, ?, ?, 'running', ?, 0, 0)"
  ).bind(runId, planId, started, rows.length).run();

  for (const rec of rows) {
    const t = rules ? transformRecordWithRules(rec, rules) : transformRecord(rec);
    if ("errors" in t) {
      rejected++;
      qStmts.push(db.prepare("INSERT INTO quarantine_records (run_id, source_record_json, field_errors_json) VALUES (?, ?, ?)").bind(runId, JSON.stringify(rec), JSON.stringify(t.errors)));
    } else {
      accepted++;
      insertStmts.push(
        (() => {
          const uuid = "contractor_uuid" in t.out && t.out.contractor_uuid ? t.out.contractor_uuid : contractorUuidFor(rec.emp_id);
          return db.prepare(
            `INSERT INTO target_contractors (contractor_uuid, first_name, last_name, department_name, start_date, hourly_rate, status, migrated_in_run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(contractor_uuid) DO UPDATE SET migrated_in_run_id = excluded.migrated_in_run_id`
          ).bind(uuid, t.out.first_name ?? null, t.out.last_name ?? null, t.out.department_name ?? null, t.out.start_date ?? null, t.out.hourly_rate ?? null, t.out.status ?? "active", runId);
        })()
      );
    }
  }

  try {
    for (let i = 0; i < insertStmts.length; i += 50) await db.batch(insertStmts.slice(i, i + 50));
    for (let i = 0; i < qStmts.length; i += 50) await db.batch(qStmts.slice(i, i + 50));
    await db.prepare("UPDATE migration_runs SET status = 'success', completed_at = ?, accepted_count = ?, rejected_count = ? WHERE run_id = ?")
      .bind(new Date().toISOString(), accepted, rejected, runId).run();
    return { run: await db.prepare("SELECT * FROM migration_runs WHERE run_id = ?").bind(runId).first(), resumed: false };
  } catch (err) {
    await db.prepare("UPDATE migration_runs SET status = 'failed', completed_at = ? WHERE run_id = ?").bind(new Date().toISOString(), runId).run();
    throw err;
  }
}

interface ReconcileResult {
  source_total: number;
  target_total: number;
  quarantine_total: number;
  accounted: number;
  matched: boolean;
}

export async function reconcile(db: D1Database, runId?: string): Promise<ReconcileResult> {
  const s = await db.prepare("SELECT COUNT(*) AS c FROM source_employees").first<{ c: number }>();
  let target_total: number;
  let quarantine_total: number;
  if (runId) {
    const t = await db.prepare("SELECT COUNT(*) AS c FROM target_contractors WHERE migrated_in_run_id = ?").bind(runId).first<{ c: number }>();
    const q = await db.prepare("SELECT COUNT(*) AS c FROM quarantine_records WHERE run_id = ?").bind(runId).first<{ c: number }>();
    target_total = t?.c ?? 0;
    quarantine_total = q?.c ?? 0;
  } else {
    const latest = await db.prepare("SELECT run_id FROM migration_runs ORDER BY started_at DESC LIMIT 1").first<{ run_id: string }>();
    if (latest) return reconcile(db, latest.run_id);
    const t = await db.prepare("SELECT COUNT(*) AS c FROM target_contractors").first<{ c: number }>();
    const q = await db.prepare("SELECT COUNT(*) AS c FROM quarantine_records").first<{ c: number }>();
    target_total = t?.c ?? 0;
    quarantine_total = q?.c ?? 0;
  }
  const source_total = s?.c ?? 0;
  const accounted = target_total + quarantine_total;
  return { source_total, target_total, quarantine_total, accounted, matched: accounted === source_total };
}

export async function rollbackRun(db: D1Database, runId: string) {
  // D1 batch is atomic: both deletes and the status update succeed or fail together.
  await db.batch([
    db.prepare("DELETE FROM target_contractors WHERE migrated_in_run_id = ?").bind(runId),
    db.prepare("DELETE FROM quarantine_records WHERE run_id = ?").bind(runId),
    db.prepare("UPDATE migration_runs SET status = 'rolled_back', completed_at = ? WHERE run_id = ?").bind(new Date().toISOString(), runId),
  ]);
  return { rolled_back: true, run_id: runId };
}
