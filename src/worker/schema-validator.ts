import { z } from "zod";

const FIELD_TYPES = ["int", "string", "float", "uuid", "date", "ISO date", "boolean", "datetime", "number"] as const;

const fieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
});

const schemaDefinitionSchema = z.object({
  name: z.string().optional(),
  fields: z.array(fieldSchema).min(1, "Schema must declare at least one field"),
});

const ruleSchema = z.object({
  source_field: z.string().min(1),
  target_field: z.string().min(1),
  transform: z.enum(["split_name", "map_enum", "math_divide", "format_date", "direct", "direct_map"]),
  params: z.record(z.string(), z.any()).optional(),
});

export const schemaValidationInputSchema = z.object({
  source_schema: schemaDefinitionSchema,
  target_schema: schemaDefinitionSchema,
  sample_records: z.array(z.record(z.string(), z.any())).min(1, "Provide at least one example record"),
  transformation_rules: z.array(ruleSchema).default([]),
});

export type SchemaValidationInput = z.infer<typeof schemaValidationInputSchema>;

function sampleMatchesType(value: unknown, type: (typeof FIELD_TYPES)[number]): boolean {
  switch (type) {
    case "int": return Number.isInteger(value);
    case "float":
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "date":
    case "ISO date":
    case "datetime": return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
    case "uuid": return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
    default: return typeof value === "string";
  }
}

export function validateSchemas(input: SchemaValidationInput) {
  const errors: string[] = [];
  const issues: string[] = [];

  const sourceFields = new Set(input.source_schema.fields.map((f) => f.name));
  const targetFields = new Set(input.target_schema.fields.map((f) => f.name));

  // 1. Sample records must conform to the source schema
  for (const [i, rec] of input.sample_records.entries()) {
    for (const f of input.source_schema.fields) {
      if (!(f.name in rec)) errors.push(`Record ${i + 1} is missing source field "${f.name}"`);
      else if (rec[f.name] !== null && !sampleMatchesType(rec[f.name], f.type)) {
        errors.push(`Record ${i + 1}: field "${f.name}" should be ${f.type}, got ${JSON.stringify(rec[f.name])}`);
      }
    }
  }

  // 2. Every rule must reference a real source field and real target field
  const coveredTargets = new Set<string>();
  for (const rule of input.transformation_rules) {
    if (!sourceFields.has(rule.source_field)) errors.push(`Rule references unknown source field "${rule.source_field}"`);
    if (!targetFields.has(rule.target_field)) errors.push(`Rule outputs unknown target field "${rule.target_field}"`);
    coveredTargets.add(rule.target_field);
  }

  if (input.transformation_rules.length === 0) {
    issues.push("No transformation rules supplied — schema and sample records validated; migratability checked against rules later.");
    return { valid: errors.length === 0, migratable: errors.length === 0, errors, issues };
  }

  // 3. Migratability: every target field must be produced by at least one rule
  for (const tf of targetFields) {
    if (!coveredTargets.has(tf)) issues.push(`Target field "${tf}" has no transformation rule — not migratable`);
  }

  // 4. Source fields declared but never used by rules are a warning
  const usedSources = new Set(input.transformation_rules.map((r) => r.source_field));
  for (const sf of sourceFields) {
    if (!usedSources.has(sf)) issues.push(`Source field "${sf}" is never consumed by a rule (will be dropped)`);
  }

  return {
    valid: errors.length === 0,
    migratable: errors.length === 0 && issues.filter((i) => i.includes("no transformation rule")).length === 0,
    errors,
    issues,
  };
}
