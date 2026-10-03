import type { SourceEmployee } from "../shared/types";

const FIRST = ["Alice", "Bob", "Carlos", "Diana", "Evelyn", "Frank", "Grace", "Hiro", "Ivy", "Jamal", "Karen", "Liam", "Mona", "Noah", "Olga", "Priya", "Quentin", "Rosa", "Sam", "Tina", "Umar", "Vera", "Wyatt", "Xena", "Yusuf", "Zoe"];
const LAST = ["Smith", "Johnson", "Garcia", "Kim", "Patel", "Brown", "Lee", "Nguyen", "Garcia", "Miller", "Davis", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin"];
const DEPTS = ["ENG", "SALES", "HR", "FIN", "OPS", "IT"];
const FORMATS = [
  (d: Date) => d.toISOString().slice(0, 10), // 2020-03-14
  (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`, // 03/14/2020
  (d: Date) => `${d.getDate()}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`, // 14-Mar-2020
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates exactly 1000 employee records.
 * ~5% are intentionally invalid:
 *   - full_name missing a space (split_name fails)
 *   - negative salary (math_divide fails)
 *   - invalid dept_code (map_enum fails)
 *   - unparseable hire_date (format_date fails)
 */
export function generateEmployees(): SourceEmployee[] {
  const rows: SourceEmployee[] = [];
  for (let i = 1; i <= 1000; i++) {
    const first = rand(FIRST);
    const last = rand(LAST);
    const hire = new Date(2010 + Math.floor(Math.random() * 15), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28));
    let row: SourceEmployee = {
      emp_id: i,
      full_name: `${first} ${last}`,
      dept_code: rand(DEPTS),
      hire_date: rand(FORMATS)(hire),
      salary: Math.round((45000 + Math.random() * 120000) * 100) / 100,
    };

    const roll = i % 80; // ~5% invalid spread across four defect types
    if (roll === 0) row.full_name = `${first}${last}`; // missing space
    else if (roll === 20) row.salary = -Math.round(Math.random() * 50000); // negative
    else if (roll === 40) row.dept_code = "XXX"; // invalid code
    else if (roll === 60) row.hire_date = "not-a-date"; // bad date
    rows.push(row);
  }
  return rows;
}

export async function seedDatabase(db: D1Database): Promise<number> {
  const rows = generateEmployees();
  await db.prepare("DELETE FROM source_employees").run();
  // Chunk inserts to stay under D1 parameter limits (max 100 bound params).
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const stmts = chunk.map((r) =>
      db.prepare("INSERT OR REPLACE INTO source_employees (emp_id, full_name, dept_code, hire_date, salary) VALUES (?, ?, ?, ?, ?)").bind(
        r.emp_id, r.full_name, r.dept_code, r.hire_date, r.salary
      )
    );
    await db.batch(stmts);
  }
  return rows.length;
}
