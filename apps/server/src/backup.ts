import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newId, nowIso, weekdayOf, type Weekday } from "@pf/core";
import { refreshDatabase, type Db } from "./db.js";

export interface BackupImportResult {
  accounts: number;
  transactions: number;
  categories: number;
}

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

const TABLES = [
  "household",
  "accounts",
  "categories",
  "transactions",
  "budget_periods",
  "budget_lines",
  "fixed_expenses",
  "fixed_expense_months",
  "salaries",
  "salary_rates",
  "savings_plans",
  "savings_plan_months",
  "savings_plan_intervals",
  "app_meta",
] as const;

const REQUIRED_SQLITE_TABLES = ["household", "accounts", "categories", "transactions"];

interface HouseholdBackup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface JsonBackup {
  household: HouseholdBackup;
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  fixedExpenses: Record<string, unknown>[];
  fixedExpenseMonths: Record<string, unknown>[];
  salaries: Record<string, unknown>[];
  savingsPlans: Record<string, unknown>[];
  savingsPlanMonths: Record<string, unknown>[];
  savingsPlanIntervals: Record<string, unknown>[];
}

export function importJsonBackup(db: Db, payload: unknown): BackupImportResult {
  const backup = parseBackup(payload);
  withForeignKeysOff(db, () => {
    clearLedger(db);
    insertJson(db, backup);
    assertForeignKeys(db);
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('savings_amount_frequency', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    ).run();
  });
  refreshDatabase(db);
  return counts(db);
}

export function importSqliteBackup(db: Db, bytes: Buffer): BackupImportResult {
  if (bytes.length < SQLITE_MAGIC.length || !bytes.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    throw new Error("This file is not a SQLite database.");
  }
  const temp = path.join(os.tmpdir(), `pf-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  db.pragma("foreign_keys = OFF");
  let attached = false;
  try {
    fs.writeFileSync(temp, bytes);
    assertReadableBackup(temp);
    db.exec(`ATTACH DATABASE ${sqlString(temp)} AS src`);
    attached = true;
    const apply = db.transaction(() => {
      const present = new Set(tableNames(db, "src"));
      for (const table of REQUIRED_SQLITE_TABLES) {
        if (!present.has(table)) throw new Error("This file is not a PersonalFinance database.");
      }
      clearLedger(db);
      for (const table of TABLES) {
        if (present.has(table)) copyTable(db, table);
      }
      assertForeignKeys(db);
    });
    apply();
  } finally {
    if (attached) db.exec("DETACH DATABASE src");
    db.pragma("foreign_keys = ON");
    fs.rmSync(temp, { force: true });
    fs.rmSync(`${temp}-wal`, { force: true });
    fs.rmSync(`${temp}-shm`, { force: true });
  }
  refreshDatabase(db);
  return counts(db);
}

function parseBackup(payload: unknown): JsonBackup {
  const record = asRecord(payload, "This file is not a PersonalFinance backup.");
  const version = record.version;
  if (version !== 2 && version !== 3) throw new Error("This backup version is not supported.");
  return {
    household: parseHousehold(record.household),
    accounts: asRecords(record.accounts, "accounts"),
    categories: asRecords(record.categories, "categories"),
    transactions: asRecords(record.transactions, "transactions"),
    fixedExpenses: asRecords(record.fixedExpenses ?? [], "bills"),
    fixedExpenseMonths: asRecords(record.fixedExpenseMonths ?? [], "bill months"),
    salaries: asRecords(record.salaries ?? [], "salaries"),
    savingsPlans: asRecords(record.savingsPlans ?? [], "savings"),
    savingsPlanMonths: asRecords(record.savingsPlanMonths ?? [], "savings months"),
    savingsPlanIntervals: asRecords(record.savingsPlanIntervals ?? [], "savings dates"),
  };
}

function parseHousehold(value: unknown): HouseholdBackup {
  const row = asRecord(value, "This backup has no household.");
  return {
    id: requiredString(row, "id", "household"),
    name: requiredString(row, "name", "household"),
    createdAt: optionalString(row, "createdAt", "created_at") ?? nowIso(),
    updatedAt: optionalString(row, "updatedAt", "updated_at") ?? nowIso(),
  };
}

function insertJson(db: Db, backup: JsonBackup): void {
  const householdId = backup.household.id;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(householdId, backup.household.name, backup.household.createdAt, backup.household.updatedAt);

  const insertAccount = db.prepare(
    `
    INSERT INTO accounts
      (id, household_id, name, type, currency, institution, opening_balance, notes, created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @name, @type, @currency, @institution, @openingBalance, @notes, @createdAt, @updatedAt, @deletedAt)
  `,
  );
  for (const row of backup.accounts) {
    insertAccount.run({
      id: requiredString(row, "id", "account"),
      householdId,
      name: requiredString(row, "name", "account"),
      type: requiredString(row, "type", "account"),
      currency: optionalString(row, "currency") ?? "CAD",
      institution: optionalString(row, "institution"),
      openingBalance: requiredNumber(row, "openingBalance", "opening balance"),
      notes: optionalString(row, "notes"),
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
  }

  const insertCategory = db.prepare(
    `
    INSERT INTO categories
      (id, household_id, name, kind, parent_id, system, created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @name, @kind, @parentId, @system, @createdAt, @updatedAt, @deletedAt)
  `,
  );
  for (const row of backup.categories) {
    insertCategory.run({
      id: requiredString(row, "id", "category"),
      householdId,
      name: requiredString(row, "name", "category"),
      kind: requiredString(row, "kind", "category"),
      parentId: optionalString(row, "parentId"),
      system: row.system === true || row.system === 1 ? 1 : 0,
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
  }

  const insertTransaction = db.prepare(
    `
    INSERT INTO transactions
      (id, household_id, account_id, date, amount, payee, memo, category_id, transfer_group_id,
       import_hash, paid_at, created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @accountId, @date, @amount, @payee, @memo, @categoryId, @transferGroupId,
       @importHash, @paidAt, @createdAt, @updatedAt, @deletedAt)
  `,
  );
  for (const row of backup.transactions) {
    insertTransaction.run({
      id: requiredString(row, "id", "transaction"),
      householdId,
      accountId: requiredString(row, "accountId", "transaction"),
      date: requiredString(row, "date", "transaction"),
      amount: requiredNumber(row, "amount", "transaction amount"),
      payee: optionalString(row, "payee"),
      memo: optionalString(row, "memo"),
      categoryId: optionalString(row, "categoryId"),
      transferGroupId: optionalString(row, "transferGroupId"),
      importHash: optionalString(row, "importHash"),
      paidAt: paidAtFromBackup(row, optionalString(row, "createdAt") ?? stamp),
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
  }

  const insertExpense = db.prepare(
    `
    INSERT INTO fixed_expenses
      (id, household_id, name, monthly_amount, frequency, weekday, anchor_date, category_id, account_id,
       due_day, starts_on, ends_on, carry_in, created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @name, @monthlyAmount, @frequency, @weekday, @anchorDate, @categoryId, @accountId,
       @dueDay, @startsOn, @endsOn, @carryIn, @createdAt, @updatedAt, @deletedAt)
  `,
  );
  for (const row of backup.fixedExpenses) {
    insertExpense.run({
      id: requiredString(row, "id", "bill"),
      householdId,
      name: requiredString(row, "name", "bill"),
      monthlyAmount: requiredNumber(row, "monthlyAmount", "bill amount"),
      frequency: optionalString(row, "frequency") ?? "monthly",
      weekday: optionalString(row, "weekday"),
      anchorDate: optionalString(row, "anchorDate"),
      categoryId: optionalString(row, "categoryId"),
      accountId: optionalString(row, "accountId"),
      dueDay: optionalNumber(row, "dueDay"),
      startsOn: requiredString(row, "startsOn", "bill"),
      endsOn: optionalString(row, "endsOn"),
      carryIn: optionalNumber(row, "carryIn") ?? 0,
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
  }

  const insertExpenseMonth = db.prepare(
    `
    INSERT INTO fixed_expense_months
      (id, fixed_expense_id, year_month, planned_amount, paid_amount, omitted, created_at, updated_at)
    VALUES
      (@id, @fixedExpenseId, @yearMonth, @plannedAmount, @paidAmount, @omitted, @createdAt, @updatedAt)
  `,
  );
  for (const row of backup.fixedExpenseMonths) {
    insertExpenseMonth.run({
      id: requiredString(row, "id", "bill month"),
      fixedExpenseId: requiredString(row, "fixedExpenseId", "bill month"),
      yearMonth: requiredString(row, "yearMonth", "bill month"),
      plannedAmount: optionalNumber(row, "plannedAmount"),
      paidAmount: optionalNumber(row, "paidAmount"),
      omitted: row.omitted === true || row.omitted === 1 ? 1 : 0,
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
    });
  }

  const insertSalary = db.prepare(
    `
    INSERT INTO salaries
      (id, household_id, name, weekly_amount, payday, anchor_date, starts_on, category_id, account_id,
       created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @name, @amount, @payday, @anchorDate, @startsOn, @categoryId, @accountId,
       @createdAt, @updatedAt, @deletedAt)
  `,
  );
  const insertRate = db.prepare(
    `
    INSERT INTO salary_rates (id, salary_id, effective_on, amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  );
  for (const row of backup.salaries) {
    const id = requiredString(row, "id", "salary");
    const anchorDate = optionalString(row, "anchorDate");
    const startsOn = requiredString(row, "startsOn", "salary");
    insertSalary.run({
      id,
      householdId,
      name: requiredString(row, "name", "salary"),
      amount: requiredNumber(row, "amount", "paycheck"),
      payday: paydayFor(anchorDate, startsOn),
      anchorDate,
      startsOn,
      categoryId: optionalString(row, "categoryId"),
      accountId: optionalString(row, "accountId"),
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
    const rates = Array.isArray(row.rates) ? row.rates : [];
    for (const rate of rates) {
      const item = asRecord(rate, "A salary change is incomplete.");
      insertRate.run(
        newId(),
        id,
        requiredString(item, "effectiveOn", "salary change"),
        requiredNumber(item, "amount", "paycheck"),
        stamp,
        stamp,
      );
    }
  }

  const insertPlan = db.prepare(
    `
    INSERT INTO savings_plans
      (id, household_id, name, amount, frequency, weekday, from_account_id, to_account_id, starts_on,
       ends_on, carry_in, created_at, updated_at, deleted_at)
    VALUES
      (@id, @householdId, @name, @amount, @frequency, @weekday, @fromAccountId, @toAccountId, @startsOn,
       @endsOn, @carryIn, @createdAt, @updatedAt, @deletedAt)
  `,
  );
  for (const row of backup.savingsPlans) {
    insertPlan.run({
      id: requiredString(row, "id", "savings objective"),
      householdId,
      name: requiredString(row, "name", "savings objective"),
      amount: requiredNumber(row, "amount", "savings amount"),
      frequency: requiredString(row, "frequency", "savings objective"),
      weekday: optionalString(row, "weekday"),
      fromAccountId: requiredString(row, "fromAccountId", "savings objective"),
      toAccountId: requiredString(row, "toAccountId", "savings objective"),
      startsOn: requiredString(row, "startsOn", "savings objective"),
      endsOn: optionalString(row, "endsOn"),
      carryIn: optionalNumber(row, "carryIn") ?? 0,
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
      deletedAt: optionalString(row, "deletedAt"),
    });
  }

  const insertPlanMonth = db.prepare(
    `
    INSERT INTO savings_plan_months
      (id, savings_plan_id, year_month, planned_amount, omitted, created_at, updated_at)
    VALUES
      (@id, @savingsPlanId, @yearMonth, @plannedAmount, @omitted, @createdAt, @updatedAt)
  `,
  );
  for (const row of backup.savingsPlanMonths) {
    insertPlanMonth.run({
      id: requiredString(row, "id", "savings month"),
      savingsPlanId: requiredString(row, "savingsPlanId", "savings month"),
      yearMonth: requiredString(row, "yearMonth", "savings month"),
      plannedAmount: requiredNumber(row, "plannedAmount", "savings month"),
      omitted: row.omitted === true || row.omitted === 1 ? 1 : 0,
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
    });
  }

  const insertInterval = db.prepare(
    `
    INSERT INTO savings_plan_intervals
      (id, savings_plan_id, from_date, to_date, amount, created_at, updated_at)
    VALUES
      (@id, @savingsPlanId, @fromDate, @toDate, @amount, @createdAt, @updatedAt)
  `,
  );
  for (const row of backup.savingsPlanIntervals) {
    insertInterval.run({
      id: requiredString(row, "id", "savings dates"),
      savingsPlanId: requiredString(row, "savingsPlanId", "savings dates"),
      fromDate: requiredString(row, "from", "savings dates"),
      toDate: requiredString(row, "to", "savings dates"),
      amount: requiredNumber(row, "amount", "savings dates"),
      createdAt: optionalString(row, "createdAt") ?? stamp,
      updatedAt: optionalString(row, "updatedAt") ?? stamp,
    });
  }
}

function clearLedger(db: Db): void {
  for (const table of [...TABLES].reverse()) {
    if (tableNames(db, "main").includes(table)) db.prepare(`DELETE FROM ${table}`).run();
  }
}

function copyTable(db: Db, table: (typeof TABLES)[number]): void {
  const source = columnNames(db, "src", table);
  const destination = columnNames(db, "main", table);
  const shared = destination.filter((column) => source.includes(column));
  if (shared.length === 0) return;
  const columns = shared.join(", ");
  db.prepare(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM src.${table}`).run();
  if (table === "transactions" && !source.includes("paid_at")) {
    db.prepare(`UPDATE main.transactions SET paid_at = created_at WHERE paid_at IS NULL`).run();
  }
}

function assertReadableBackup(filePath: string): void {
  const incoming = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const names = new Set(tableNames(incoming, "main"));
    for (const table of REQUIRED_SQLITE_TABLES) {
      if (!names.has(table)) throw new Error("This file is not a PersonalFinance database.");
    }
    const household = incoming.prepare(`SELECT COUNT(*) AS n FROM household`).get() as { n: number };
    if (!household.n) throw new Error("This backup has no household.");
  } finally {
    incoming.close();
  }
}

function tableNames(db: Db, schema: "main" | "src"): string[] {
  const rows = db
    .prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'`)
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function columnNames(db: Db, schema: "main" | "src", table: string): string[] {
  const rows = db.prepare(`PRAGMA ${schema}.table_info('${table}')`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

function withForeignKeysOff(db: Db, work: () => void): void {
  db.pragma("foreign_keys = OFF");
  try {
    const apply = db.transaction(work);
    apply();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function assertForeignKeys(db: Db): void {
  const problems = db.prepare(`PRAGMA foreign_key_check`).all() as unknown[];
  if (problems.length > 0) {
    throw new Error("This backup refers to an account or category that is missing.");
  }
}

export function backupErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = "code" in err ? String((err as { code?: string }).code ?? "") : "";
    if (code.startsWith("SQLITE_CONSTRAINT")) {
      return "This backup is missing a required value or repeats one.";
    }
    if (err.message.startsWith("This ") || err.message.startsWith("A ") || err.message.startsWith("Choose ")) {
      return err.message;
    }
  }
  return "This backup could not be read.";
}

function counts(db: Db): BackupImportResult {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get() as { n: number }).n;
  return {
    accounts: count("accounts"),
    transactions: count("transactions"),
    categories: count("categories"),
  };
}

function paydayFor(anchorDate: string | null, startsOn: string): Weekday {
  const candidate = anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ? anchorDate : `${startsOn}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    try {
      return weekdayOf(candidate);
    } catch {
      return "friday";
    }
  }
  return "friday";
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function asRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`This backup is missing ${label}.`);
  return value.map((item) => asRecord(item, `A ${label} entry is incomplete.`));
}

function requiredString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`A ${label} is missing its ${key}.`);
  return value;
}

/** Older backups had no paid flag. Those rows already counted toward the balance. */
function paidAtFromBackup(row: Record<string, unknown>, createdAt: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, "paidAt")) return createdAt;
  return optionalString(row, "paidAt");
}

function optionalString(row: Record<string, unknown>, key: string, alternate?: string): string | null {
  const value = row[key] ?? (alternate ? row[alternate] : undefined);
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`A ${key} should be text.`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string, label: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`A ${label} should be a number.`);
  return value;
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`A ${key} should be a number.`);
  return value;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
