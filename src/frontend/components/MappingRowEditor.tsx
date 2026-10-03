import { useState } from "react";
import { Parser } from "expr-eval";
import { Button, Badge } from "./ui";

export interface MappingRow {
  target_field: string;
  target_type: string;
  source_field: string | null; // null = unmapped
  transform: "direct_map" | "split_name" | "map_enum" | "math_divide" | "format_date" | "expression" | "skip";
  expression: string; // expr-eval syntax (advanced mode)
  expressionValid: boolean;
  status: "mapped" | "unmapped" | "skip";
}

const SIMPLE_OPTIONS = [
  { value: "direct_map", label: "Default (Direct Map)" },
  { value: "split_name", label: "Split Name" },
  { value: "format_date", label: "Convert Date" },
  { value: "math_custom", label: "Math — custom ( + − × ÷ )" },
  { value: "map_enum", label: "Map Enum" },
  { value: "skip", label: "Skip / Null" },
];

const MATH_OPS = ["+", "-", "*", "/"] as const;

export function validateExpression(expr: string, sourceFields: string[]): boolean {
  if (!expr.trim()) return false;
  try {
    const parsed = new Parser().parse(expr);
    const missing = parsed.variables().filter((v) => !sourceFields.includes(v));
    return missing.length === 0;
  } catch {
    return false;
  }
}

export default function MappingRowEditor({
  row,
  sourceFields,
  onSave,
  onClose,
}: {
  row: MappingRow;
  sourceFields: string[];
  onSave: (row: MappingRow) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"simple" | "advanced">(row.transform === "expression" ? "advanced" : "simple");
  const [transform, setTransform] = useState(row.transform === "expression" ? "expression" : row.transform === "math_divide" ? "math_custom" : row.transform);
  const [sourceField, setSourceField] = useState<string>(row.source_field ?? "");
  const [expression, setExpression] = useState(row.expression ?? "");
  const [mathOp, setMathOp] = useState<string>("/");
  const [mathOperand, setMathOperand] = useState<string>("2080");
  const exprValid = mode === "advanced" ? validateExpression(expression, sourceFields) : true;
  const mathValid = transform !== "math_custom" || (mathOperand.trim() !== "" && !Number.isNaN(Number(mathOperand)) && !(mathOp === "/" && Number(mathOperand) === 0));

  function handleSave() {
    if (mode === "advanced") {
      if (!expression.trim()) {
        // Blank editor → revert to default direct_map behavior
        const sameName = sourceFields.includes(row.target_field) ? row.target_field : null;
        onSave({ ...row, transform: sameName ? "direct_map" : "skip", source_field: sameName, expression: "", expressionValid: true });
        return;
      }
      if (!exprValid) return;
      onSave({ ...row, transform: "expression", expression, expressionValid: true, source_field: null });
      return;
    }
    if (transform === "direct_map") {
      const sameName = sourceFields.includes(row.target_field) ? row.target_field : sourceField || null;
      onSave({ ...row, transform: sameName ? "direct_map" : "skip", source_field: sameName, expression: "", expressionValid: true });
      return;
    }
    if (transform === "skip") {
      onSave({ ...row, transform: "skip", source_field: null, expression: "", expressionValid: true });
      return;
    }
    if (transform === "math_custom") {
      if (!mathValid || !sourceField) return;
      const expr = `${sourceField} ${mathOp} ${mathOperand}`;
      onSave({ ...row, transform: "expression", source_field: sourceField, expression: expr, expressionValid: true });
      return;
    }
    onSave({ ...row, transform: transform as MappingRow["transform"], source_field: sourceField || null, expression: "", expressionValid: true });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit mapping: {row.target_field}</h3>
          <Badge tone="blue">{row.target_type}</Badge>
        </div>

        <div className="flex gap-2 text-sm">
          <button className={`px-3 py-1 rounded ${mode === "simple" ? "bg-primary text-white" : "bg-slate-100"}`} onClick={() => setMode("simple")}>Simple</button>
          <button className={`px-3 py-1 rounded ${mode === "advanced" ? "bg-primary text-white" : "bg-slate-100"}`} onClick={() => setMode("advanced")}>Advanced</button>
        </div>

        {mode === "simple" ? (
          <div className="space-y-3">
            <label className="block text-xs font-semibold">Task
              <select className="mt-1 w-full rounded-md border border-slate-300 p-2" value={transform} onChange={(e) => setTransform(e.target.value as any)}>
                {SIMPLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {transform !== "direct_map" && transform !== "skip" && (
              <label className="block text-xs font-semibold">Source field
                <select className="mt-1 w-full rounded-md border border-slate-300 p-2" value={sourceField} onChange={(e) => setSourceField(e.target.value)}>
                  <option value="">— select —</option>
                  {sourceFields.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            {transform === "math_custom" && (
              <div className="flex items-end gap-2">
                <label className="block text-xs font-semibold flex-1">Operation
                  <select className="mt-1 w-full rounded-md border border-slate-300 p-2" value={mathOp} onChange={(e) => setMathOp(e.target.value)}>
                    {MATH_OPS.map((o) => <option key={o} value={o}>{{ "+": "Add (+)", "-": "Subtract (−)", "*": "Multiply (×)", "/": "Divide (÷)" }[o]}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold flex-1">Operand
                  <input className="mt-1 w-full rounded-md border border-slate-300 p-2" value={mathOperand} onChange={(e) => setMathOperand(e.target.value)} placeholder="e.g. 2080" />
                </label>
              </div>
            )}
            {transform === "math_custom" && !mathValid && (
              <p className="text-xs text-red-600">{mathOp === "/" && Number(mathOperand) === 0 ? "Cannot divide by zero." : "Operand must be a valid number."}</p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold">Expression (expr-eval syntax — variables are source fields: {sourceFields.join(", ")})
              <textarea
                className={`mt-1 w-full h-28 rounded-md border p-2 font-mono text-sm ${expression && !exprValid ? "border-red-400 bg-red-50" : "border-slate-300 bg-slate-50"}`}
                placeholder={`e.g. salary / 2080`}
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
              />
            </label>
            {expression && !exprValid && <p className="text-xs text-red-600 mt-1">Syntax error, or unknown variable. Leave blank to revert to default direct map.</p>}
          </div>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => { onSave({ ...row, transform: sourceFields.includes(row.target_field) ? "direct_map" : "skip", source_field: sourceFields.includes(row.target_field) ? row.target_field : null, expression: "", expressionValid: true }); }}>Reset to Default</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={(mode === "advanced" && !!expression && !exprValid) || (transform === "math_custom" && (!mathValid || !sourceField))}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
