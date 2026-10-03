import { z } from "zod";

// ---------- Source / Target domain records ----------
export interface SourceEmployee {
  emp_id: number;
  full_name: string | null;
  dept_code: string | null;
  hire_date: string | null;
  salary: number | null;
}

export interface TargetContractor {
  contractor_uuid: string;
  first_name: string;
  last_name: string;
  department_name: string;
  start_date: string;
  hourly_rate: number;
  status: string;
  migrated_in_run_id: string;
}

export interface FieldError {
  field: string;
  error: string;
}

// ---------- Migration plan (AI output, zod-validated) ----------
export const mappingRuleSchema = z.object({
  source_field: z.string(),
  target_field: z.string(),
  transform: z.enum(["split_name", "map_enum", "math_divide", "format_date", "direct", "direct_map", "expression", "skip"]),
  params: z.record(z.string(), z.any()).optional(),
});

export const migrationPlanSchema = z.object({
  source_schema: z.string(),
  target_schema: z.string(),
  mappings: z.array(mappingRuleSchema).min(1),
  risk_assessment: z.string().optional(),
  notes: z.string().optional(),
  clarification_questions: z.array(z.string()).optional(),
});

export type MappingRule = z.infer<typeof mappingRuleSchema>;
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;

// ---------- API payloads ----------
export interface DryRunResult {
  source_count: number;
  accepted_count: number;
  rejected_count: number;
}

export interface ReconcileResult {
  source_total: number;
  target_total: number;
  quarantine_total: number;
  accounted: number;
  matched: boolean;
}

export interface HistoryRow {
  run_id: string;
  plan_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: string | null;
  source_count: number | null;
  accepted_count: number | null;
  rejected_count: number | null;
}

export const DEPT_CODE_MAP: Record<string, string> = {
  ENG: "Engineering",
  SALES: "Sales",
  HR: "Human Resources",
  FIN: "Finance",
  OPS: "Operations",
  IT: "Information Technology",
};
