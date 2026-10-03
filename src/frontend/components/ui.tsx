import React, { useState } from "react";

export function Button({ className = "", variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "destructive" | "outline" }) {
  const styles =
    variant === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-red-700"
      : variant === "outline"
      ? "border border-slate-300 bg-white hover:bg-slate-100"
      : "bg-primary text-primary-foreground hover:bg-blue-700";
  return <button className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`} {...props} />;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-card p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t, i) => (
        <button
          key={t}
          onClick={() => onChange(i)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${i === active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function Table({ headers, rows }: { headers: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>{headers.map((h, i) => <th key={i} className="px-4 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50">
              {r.map((c, j) => <td key={j} className="px-4 py-2 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toast({ message, tone }: { message: string | null; tone: "success" | "error" }) {
  if (!message) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-50 rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg ${tone === "success" ? "bg-green-600" : "bg-red-600"}`}>
      {message}
    </div>
  );
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel }: { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Confirm Rollback</Button>
        </div>
      </div>
    </div>
  );
}

export function ExpandableQuarantineTable({ records }: { records: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr><th className="px-4 py-2"></th><th className="px-4 py-2">ID</th><th className="px-4 py-2">Run ID</th><th className="px-4 py-2">Source Record</th><th className="px-4 py-2">Created</th></tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <React.Fragment key={r.id}>
              <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="px-4 py-2">{open === r.id ? "▼" : "▶"}</td>
                <td className="px-4 py-2">{r.id}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.run_id}</td>
                <td className="px-4 py-2 font-mono text-xs max-w-md truncate">{r.source_record_json}</td>
                <td className="px-4 py-2">{r.created_at}</td>
              </tr>
              {open === r.id && (
                <tr className="bg-slate-50">
                  <td colSpan={5} className="px-6 py-3">
                    <div className="text-xs font-semibold mb-1">Field Errors</div>
                    <pre className="rounded bg-red-50 p-3 text-xs text-red-800 overflow-x-auto">{JSON.stringify(JSON.parse(r.field_errors_json), null, 2)}</pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
