CREATE TABLE IF NOT EXISTS source_employees (
    emp_id INTEGER PRIMARY KEY,
    full_name TEXT,
    dept_code TEXT,
    hire_date TEXT,
    salary REAL
);

CREATE TABLE IF NOT EXISTS migration_plans (
    plan_id TEXT PRIMARY KEY,
    version INTEGER DEFAULT 1,
    source_schema TEXT,
    target_schema TEXT,
    mapping_rules TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME
);

CREATE TABLE IF NOT EXISTS migration_runs (
    run_id TEXT PRIMARY KEY,
    plan_id TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    status TEXT,
    source_count INTEGER,
    accepted_count INTEGER,
    rejected_count INTEGER,
    retries INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS target_contractors (
    contractor_uuid TEXT PRIMARY KEY,
    first_name TEXT, last_name TEXT, department_name TEXT,
    start_date TEXT, hourly_rate REAL, status TEXT,
    migrated_in_run_id TEXT
);

CREATE TABLE IF NOT EXISTS quarantine_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    source_record_json TEXT,
    field_errors_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
