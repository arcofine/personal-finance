import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  buildDefaultCategories,
  DEFAULT_CURRENCY,
  newId,
  nowIso,
  occurrencesFor,
  round2,
  type Weekday,
} from "@pf/core";

export type Db = Database.Database;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','placement')),
  currency TEXT NOT NULL DEFAULT 'CAD',
  institution TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  parent_id TEXT REFERENCES categories(id),
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  payee TEXT,
  memo TEXT,
  category_id TEXT REFERENCES categories(id),
  transfer_group_id TEXT,
  import_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_import_hash
  ON transactions(account_id, import_hash)
  WHERE import_hash IS NOT NULL AND deleted_at IS NULL;

-- Reserved for variable category envelopes (not used by fixed expenses).
CREATE TABLE IF NOT EXISTS budget_periods (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  year_month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, year_month)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id TEXT PRIMARY KEY,
  budget_period_id TEXT NOT NULL REFERENCES budget_periods(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (budget_period_id, category_id)
);

-- Recurring bills. Leftover balance is computed month to month, not stored.
CREATE TABLE IF NOT EXISTS fixed_expenses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  monthly_amount REAL NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  weekday TEXT,
  anchor_date TEXT,
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  due_day INTEGER,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  carry_in REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fixed_expenses_household
  ON fixed_expenses(household_id);

CREATE TABLE IF NOT EXISTS fixed_expense_months (
  id TEXT PRIMARY KEY,
  fixed_expense_id TEXT NOT NULL REFERENCES fixed_expenses(id),
  year_month TEXT NOT NULL,
  planned_amount REAL,
  paid_amount REAL,
  omitted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (fixed_expense_id, year_month)
);

CREATE TABLE IF NOT EXISTS salaries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  weekly_amount REAL NOT NULL,
  payday TEXT NOT NULL,
  anchor_date TEXT,
  starts_on TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_salaries_household ON salaries(household_id);

CREATE TABLE IF NOT EXISTS salary_rates (
  id TEXT PRIMARY KEY,
  salary_id TEXT NOT NULL REFERENCES salaries(id),
  effective_on TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salary_id, effective_on)
);

CREATE TABLE IF NOT EXISTS savings_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  weekday TEXT,
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT NOT NULL REFERENCES accounts(id),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  carry_in REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_savings_plans_household
  ON savings_plans(household_id);

CREATE TABLE IF NOT EXISTS savings_plan_months (
  id TEXT PRIMARY KEY,
  savings_plan_id TEXT NOT NULL REFERENCES savings_plans(id),
  year_month TEXT NOT NULL,
  planned_amount REAL NOT NULL,
  omitted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (savings_plan_id, year_month)
);

CREATE TABLE IF NOT EXISTS savings_plan_intervals (
  id TEXT PRIMARY KEY,
  savings_plan_id TEXT NOT NULL REFERENCES savings_plans(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  ensureBudgetColumns(db);
  ensureHousehold(db);
  normalizeExpenseAmounts(db);
  migrateSavingsAmountsToFrequency(db);
  return db;
}

/**
 * Month amounts used to be the full month. They are now the amount for each
 * usual day, matching the objective's frequency. Existing totals are split
 * once so the month's planned total stays the same.
 */
function migrateSavingsAmountsToFrequency(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const done = db
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .get("savings_amount_frequency") as { value: string } | undefined;
  if (done) return;
  const rows = db
    .prepare(
      `
      SELECT m.id, m.year_month, m.planned_amount, p.frequency, p.weekday
      FROM savings_plan_months m
      JOIN savings_plans p ON p.id = m.savings_plan_id
    `,
    )
    .all() as {
    id: string;
    year_month: string;
    planned_amount: number;
    frequency: "weekly" | "monthly";
    weekday: Weekday | null;
  }[];
  const update = db.prepare(`UPDATE savings_plan_months SET planned_amount = ? WHERE id = ?`);
  for (const row of rows) {
    const count = occurrencesFor(row.year_month, row.frequency, row.weekday, null).count;
    update.run(count > 0 ? round2(row.planned_amount / count) : row.planned_amount, row.id);
  }
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run("savings_amount_frequency", "1");
}

/** Monthly bills created before a due date existed take the day of their latest payment. */
function backfillMonthlyDueDays(db: Db): void {
  const expenses = db
    .prepare(
      `
      SELECT id, category_id, account_id
      FROM fixed_expenses
      WHERE deleted_at IS NULL AND frequency = 'monthly' AND due_day IS NULL AND category_id IS NOT NULL
    `,
    )
    .all() as { id: string; category_id: string; account_id: string | null }[];
  const latest = db.prepare(
    `
    SELECT date FROM transactions
    WHERE deleted_at IS NULL
      AND transfer_group_id IS NULL
      AND amount < 0
      AND category_id = ?
      AND (? IS NULL OR account_id = ?)
    ORDER BY date DESC
    LIMIT 1
  `,
  );
  const update = db.prepare(`UPDATE fixed_expenses SET due_day = ? WHERE id = ?`);
  for (const expense of expenses) {
    const payment = latest.get(expense.category_id, expense.account_id, expense.account_id) as
      | { date: string }
      | undefined;
    const day = Number(payment?.date.slice(8, 10));
    if (day >= 1 && day <= 31) update.run(day, expense.id);
  }
}

/** Expense categories always leave the account, including rows saved before that rule. */
function normalizeExpenseAmounts(db: Db): void {
  db.prepare(
    `
    UPDATE transactions
    SET amount = -ABS(amount), updated_at = ?
    WHERE deleted_at IS NULL
      AND amount > 0
      AND category_id IN (
        SELECT id FROM categories WHERE kind = 'expense' AND deleted_at IS NULL
      )
  `,
  ).run(nowIso());
}

/** Existing databases were created before frequency and weekday columns existed. */
function ensureBudgetColumns(db: Db): void {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(fixed_expenses)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("frequency")) {
    db.exec(
      `ALTER TABLE fixed_expenses ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'`,
    );
  }
  if (!columns.has("weekday")) {
    db.exec(`ALTER TABLE fixed_expenses ADD COLUMN weekday TEXT`);
  }
  if (!columns.has("anchor_date")) {
    db.exec(`ALTER TABLE fixed_expenses ADD COLUMN anchor_date TEXT`);
  }
  if (!columns.has("account_id")) {
    db.exec(`ALTER TABLE fixed_expenses ADD COLUMN account_id TEXT REFERENCES accounts(id)`);
  }
  if (!columns.has("ends_on")) {
    db.exec(`ALTER TABLE fixed_expenses ADD COLUMN ends_on TEXT`);
  }
  if (!columns.has("due_day")) {
    db.exec(`ALTER TABLE fixed_expenses ADD COLUMN due_day INTEGER`);
  }
  backfillMonthlyDueDays(db);

  const monthColumns = new Set(
    (db.prepare(`PRAGMA table_info(fixed_expense_months)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (monthColumns.size > 0 && !monthColumns.has("omitted")) {
    db.exec(`ALTER TABLE fixed_expense_months ADD COLUMN omitted INTEGER NOT NULL DEFAULT 0`);
  }

  const savingsColumns = new Set(
    (db.prepare(`PRAGMA table_info(savings_plans)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (savingsColumns.size > 0 && !savingsColumns.has("ends_on")) {
    db.exec(`ALTER TABLE savings_plans ADD COLUMN ends_on TEXT`);
  }
  const savingsMonthColumns = new Set(
    (db.prepare(`PRAGMA table_info(savings_plan_months)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (savingsMonthColumns.size > 0 && !savingsMonthColumns.has("omitted")) {
    db.exec(`ALTER TABLE savings_plan_months ADD COLUMN omitted INTEGER NOT NULL DEFAULT 0`);
  }

  const salaryColumns = new Set(
    (db.prepare(`PRAGMA table_info(salaries)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (salaryColumns.size > 0 && !salaryColumns.has("anchor_date")) {
    db.exec(`ALTER TABLE salaries ADD COLUMN anchor_date TEXT`);
  }
  if (salaryColumns.size > 0 && !salaryColumns.has("account_id")) {
    db.exec(`ALTER TABLE salaries ADD COLUMN account_id TEXT REFERENCES accounts(id)`);
  }
}

function ensureHousehold(db: Db): string {
  const existing = db.prepare(`SELECT id FROM household LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const id = newId();
  const stamp = nowIso();
  const seed = db.transaction(() => {
    db.prepare(
      `INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(id, "Household", stamp, stamp);

    const cats = buildDefaultCategories(id);
    const insert = db.prepare(`
      INSERT INTO categories
        (id, household_id, name, kind, parent_id, system, created_at, updated_at, deleted_at)
      VALUES
        (@id, @householdId, @name, @kind, @parentId, @system, @createdAt, @updatedAt, @deletedAt)
    `);
    for (const c of cats) {
      insert.run({
        id: c.id,
        householdId: c.householdId,
        name: c.name,
        kind: c.kind,
        parentId: c.parentId,
        system: c.system ? 1 : 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        deletedAt: c.deletedAt,
      });
    }
  });
  seed();
  return id;
}

export function getHouseholdId(db: Db): string {
  const row = db.prepare(`SELECT id FROM household LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (!row) throw new Error("No household row — database not initialized");
  return row.id;
}

export { DEFAULT_CURRENCY };
