import {
  assertISODate,
  assertYearMonth,
  buildBudgetMonth,
  buildSalaryMonth,
  monthBounds,
  newId,
  nowIso,
  parseWeekday,
  round2,
  shiftYearMonth,
  weekdayOf,
  type BudgetMonth,
  type BudgetMonthRow,
  type CreateFixedExpenseInput,
  type CreateSalaryInput,
  type ExpenseActivity,
  type FixedExpense,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseMonthPatch,
  type FixedExpenseRemoval,
  type FixedExpenseTemplate,
  type PayFrequency,
  type Salary,
  type SalaryRate,
  type SalaryReceipt,
  type SalaryTemplate,
  type UpdateFixedExpenseInput,
  type UpdateSalaryInput,
  type Weekday,
} from "@pf/core";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";

interface FixedExpenseRow {
  id: string;
  household_id: string;
  name: string;
  monthly_amount: number;
  frequency: string | null;
  weekday: string | null;
  anchor_date: string | null;
  category_id: string | null;
  account_id: string | null;
  due_day: number | null;
  starts_on: string;
  ends_on: string | null;
  carry_in: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MonthRow {
  id: string;
  fixed_expense_id: string;
  year_month: string;
  planned_amount: number | null;
  paid_amount: number | null;
  omitted: number;
  created_at: string;
  updated_at: string;
}

interface CategoryNode {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
}

function mapExpense(row: FixedExpenseRow): FixedExpense {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    monthlyAmount: row.monthly_amount,
    frequency: storedFrequency(row.frequency),
    weekday: storedWeekday(row.weekday),
    anchorDate: row.anchor_date,
    dueDay: storedDueDay(row.due_day),
    categoryId: row.category_id,
    accountId: row.account_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    carryIn: row.carry_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function sameAccountScope(left: string | null, right: string | null): boolean {
  return !left || !right || left === right;
}

function parseAccountId(db: Db, value: string | null | undefined): string | null {
  if (!value) return null;
  const householdId = getHouseholdId(db);
  const row = db
    .prepare(
      `SELECT id FROM accounts WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
    )
    .get(value, householdId) as { id: string } | undefined;
  if (!row) throw new Error("Account not found");
  return row.id;
}

function loadAccountNames(db: Db, householdId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT id, name FROM accounts WHERE household_id = ? AND deleted_at IS NULL`,
    )
    .all(householdId) as { id: string; name: string }[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

function parseName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Name is required");
  const name = value.trim();
  if (!name) throw new Error("Name is required");
  if (name.length > 80) throw new Error("Name must be 80 characters or fewer");
  return name;
}

function storedFrequency(value: string | null): PayFrequency {
  if (value === "weekly" || value === "biweekly" || value === "monthly") return value;
  return "monthly";
}

function storedWeekday(value: string | null): Weekday | null {
  if (!value) return null;
  try {
    return parseWeekday(value);
  } catch {
    return null;
  }
}

function storedDueDay(value: number | null): number | null {
  if (value == null || !Number.isInteger(value) || value < 1 || value > 31) return null;
  return value;
}

function parseDueDay(value: unknown): number {
  const day = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Pick a due date");
  return day;
}

function parseFrequency(value: unknown): PayFrequency {
  if (value === undefined || value === null || value === "") return "monthly";
  if (value === "weekly" || value === "biweekly" || value === "monthly") return value;
  throw new Error("Frequency must be weekly, bi-weekly, or monthly");
}

function normalizeSchedule(input: {
  frequency: PayFrequency;
  weekday: Weekday | null;
  anchorDate: string | null;
  dueDay: number | null;
  startsOn: string;
}): {
  frequency: PayFrequency;
  weekday: Weekday | null;
  anchorDate: string | null;
  dueDay: number | null;
  startsOn: string;
} {
  if (input.frequency === "weekly") {
    if (!input.weekday) throw new Error("Pick a day of the week");
    return {
      frequency: "weekly",
      weekday: input.weekday,
      anchorDate: null,
      dueDay: null,
      startsOn: input.startsOn,
    };
  }
  if (input.frequency === "biweekly") {
    if (!input.anchorDate) throw new Error("Pick the first due date");
    const anchorDate = assertISODate(input.anchorDate);
    const anchorMonth = anchorDate.slice(0, 7);
    return {
      frequency: "biweekly",
      weekday: null,
      anchorDate,
      dueDay: null,
      startsOn: anchorMonth > input.startsOn ? anchorMonth : input.startsOn,
    };
  }
  if (input.dueDay == null) throw new Error("Pick a due date");
  return {
    frequency: "monthly",
    weekday: null,
    anchorDate: null,
    dueDay: input.dueDay,
    startsOn: input.startsOn,
  };
}

function parseMoney(value: unknown, label: string, allowNegative: boolean): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) throw new Error(`${label} must be a number`);
  if (!allowNegative && amount < 0) throw new Error(`${label} cannot be negative`);
  return round2(amount);
}

function loadCategories(db: Db): CategoryNode[] {
  return db
    .prepare(
      `SELECT id, name, kind, parent_id FROM categories WHERE deleted_at IS NULL`,
    )
    .all() as CategoryNode[];
}

function categoryTree(categories: CategoryNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const list = children.get(category.parent_id) ?? [];
    list.push(category.id);
    children.set(category.parent_id, list);
  }

  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return ids;
}

function assertCategoryAvailable(
  db: Db,
  categoryId: string | null,
  accountId: string | null,
  exceptExpenseId?: string,
): void {
  if (!categoryId) return;
  const categories = loadCategories(db);
  const category = categories.find((row) => row.id === categoryId);
  if (!category) throw new Error("Category not found");
  if (category.kind !== "expense") {
    throw new Error("Link an expense category so spending counts against this bill");
  }

  const mine = categoryTree(categories, categoryId);
  const others = db
    .prepare(
      `
      SELECT id, name, category_id, account_id
      FROM fixed_expenses
      WHERE deleted_at IS NULL AND category_id IS NOT NULL AND id != ?
    `,
    )
    .all(exceptExpenseId ?? "") as {
    id: string;
    name: string;
    category_id: string;
    account_id: string | null;
  }[];

  for (const other of others) {
    if (!sameAccountScope(accountId, other.account_id)) continue;
    const theirs = categoryTree(categories, other.category_id);
    for (const id of mine) {
      if (theirs.has(id)) {
        throw new Error(
          `That category overlaps "${other.name}", so the same spending would count twice`,
        );
      }
    }
  }
}

function getActive(db: Db, id: string): FixedExpenseRow | null {
  const householdId = getHouseholdId(db);
  const row = db
    .prepare(
      `
      SELECT * FROM fixed_expenses
      WHERE id = ? AND household_id = ? AND deleted_at IS NULL
    `,
    )
    .get(id, householdId) as FixedExpenseRow | undefined;
  return row ?? null;
}

export function budgetMonth(db: Db, yearMonthInput: string): BudgetMonth {
  const yearMonth = assertYearMonth(yearMonthInput);
  const householdId = getHouseholdId(db);
  const expenseRows = db
    .prepare(
      `
      SELECT * FROM fixed_expenses
      WHERE household_id = ? AND deleted_at IS NULL AND starts_on <= ?
        AND (ends_on IS NULL OR ends_on >= ?)
      ORDER BY name
    `,
    )
    .all(householdId, yearMonth, yearMonth) as FixedExpenseRow[];

  const categories = loadCategories(db);
  const accountNames = loadAccountNames(db, householdId);
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const omitted = loadOmittedMonths(db, householdId);
  const templates: FixedExpenseTemplate[] = expenseRows.map((row) => ({
    id: row.id,
    name: row.name,
    monthlyAmount: row.monthly_amount,
    frequency: storedFrequency(row.frequency),
    weekday: storedWeekday(row.weekday),
    anchorDate: row.anchor_date,
    dueDay: storedDueDay(row.due_day),
    categoryId: row.category_id,
    accountId: row.account_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    omittedMonths: omitted.get(row.id) ?? [],
    carryIn: row.carry_in,
  }));

  const adjustments = loadAdjustments(db, householdId);
  const activity = loadActivity(db, householdId, templates, categories, yearMonth);
  const built = buildBudgetMonth(yearMonth, templates, adjustments, activity);

  const rows: BudgetMonthRow[] = built.rows.map((row) => ({
    ...row,
    categoryName: row.categoryId ? (nameById.get(row.categoryId) ?? null) : null,
    accountName: row.accountId ? (accountNames.get(row.accountId) ?? null) : null,
  }));

  const salaryRows = loadSalaries(db, householdId).filter((salary) => salary.startsOn <= yearMonth);
  const sharedSalaryIds = sharedCategorySalaryIds(salaryRows, categories);
  const receipts = loadSalaryReceipts(
    db,
    householdId,
    salaryRows.filter((salary) => !sharedSalaryIds.has(salary.id)),
    categories,
    yearMonth,
  );
  const income = buildSalaryMonth(yearMonth, salaryRows, receipts).map((row) => ({
    ...row,
    categoryName: row.categoryId ? (nameById.get(row.categoryId) ?? null) : null,
    accountName: row.accountId ? (accountNames.get(row.accountId) ?? null) : null,
    received: sharedSalaryIds.has(row.id) ? 0 : row.received,
    receivedSource: sharedSalaryIds.has(row.id) ? ("shared" as const) : row.receivedSource,
  }));
  const incomeTotal = round2(income.reduce((sum, row) => sum + row.expected, 0));

  return {
    yearMonth,
    previousMonth: shiftYearMonth(yearMonth, -1),
    nextMonth: shiftYearMonth(yearMonth, 1),
    income,
    incomeTotal,
    rows,
    totals: built.totals,
  };
}

function loadAdjustments(db: Db, householdId: string): FixedExpenseMonthAdjustment[] {
  const rows = db
    .prepare(
      `
      SELECT m.fixed_expense_id, m.year_month, m.planned_amount, m.paid_amount
      FROM fixed_expense_months m
      JOIN fixed_expenses e ON e.id = m.fixed_expense_id
      WHERE e.household_id = ? AND e.deleted_at IS NULL AND m.omitted = 0
    `,
    )
    .all(householdId) as {
    fixed_expense_id: string;
    year_month: string;
    planned_amount: number | null;
    paid_amount: number | null;
  }[];

  return rows.map((row) => ({
    fixedExpenseId: row.fixed_expense_id,
    yearMonth: row.year_month,
    plannedAmount: row.planned_amount,
    paidAmount: row.paid_amount,
  }));
}

function loadActivity(
  db: Db,
  householdId: string,
  expenses: FixedExpenseTemplate[],
  categories: CategoryNode[],
  yearMonth: string,
): ExpenseActivity[] {
  const linked = expenses.filter((expense) => expense.categoryId);
  if (linked.length === 0) return [];

  let earliest = yearMonth;
  for (const expense of linked) {
    if (expense.startsOn < earliest) earliest = expense.startsOn;
  }
  const { to } = monthBounds(yearMonth);

  const totals = db
    .prepare(
      `
      SELECT category_id, account_id, substr(date, 1, 7) AS year_month, SUM(amount) AS total
      FROM transactions
      WHERE household_id = ?
        AND deleted_at IS NULL
        AND transfer_group_id IS NULL
        AND category_id IS NOT NULL
        AND date >= ?
        AND date <= ?
      GROUP BY category_id, account_id, substr(date, 1, 7)
    `,
    )
    .all(householdId, `${earliest}-01`, to) as {
    category_id: string;
    account_id: string;
    year_month: string;
    total: number;
  }[];

  const activity: ExpenseActivity[] = [];
  for (const expense of linked) {
    if (!expense.categoryId) continue;
    const ids = categoryTree(categories, expense.categoryId);
    const byMonth = new Map<string, number>();
    for (const row of totals) {
      if (!ids.has(row.category_id)) continue;
      if (expense.accountId && row.account_id !== expense.accountId) continue;
      byMonth.set(row.year_month, (byMonth.get(row.year_month) ?? 0) + row.total);
    }
    for (const [month, total] of byMonth) {
      activity.push({
        fixedExpenseId: expense.id,
        yearMonth: month,
        total: round2(total),
      });
    }
  }
  return activity;
}

export function createFixedExpense(db: Db, input: CreateFixedExpenseInput): FixedExpense {
  const name = parseName(input.name);
  const monthlyAmount = parseMoney(input.monthlyAmount, "Amount", false);
  const carryIn = parseMoney(input.carryIn ?? 0, "Already left over", true);
  const schedule = normalizeSchedule({
    frequency: parseFrequency(input.frequency),
    weekday: input.weekday ? parseWeekday(input.weekday) : null,
    anchorDate: input.anchorDate ?? null,
    dueDay: input.dueDay == null ? null : parseDueDay(input.dueDay),
    startsOn: assertYearMonth(input.startsOn),
  });
  const categoryId = input.categoryId || null;
  const accountId = parseAccountId(db, input.accountId);
  assertCategoryAvailable(db, categoryId, accountId);

  const id = newId();
  const stamp = nowIso();
  const householdId = getHouseholdId(db);
  db.prepare(
    `
    INSERT INTO fixed_expenses
      (id, household_id, name, monthly_amount, frequency, weekday, anchor_date,
       category_id, account_id, due_day, starts_on, carry_in, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `,
  ).run(
    id,
    householdId,
    name,
    monthlyAmount,
    schedule.frequency,
    schedule.weekday,
    schedule.anchorDate,
    categoryId,
    accountId,
    schedule.dueDay,
    schedule.startsOn,
    carryIn,
    stamp,
    stamp,
  );

  return mapExpense(getActive(db, id)!);
}

export function updateFixedExpense(
  db: Db,
  id: string,
  input: UpdateFixedExpenseInput,
): FixedExpense | null {
  const existing = getActive(db, id);
  if (!existing) return null;

  const name = input.name !== undefined ? parseName(input.name) : existing.name;
  const monthlyAmount =
    input.monthlyAmount !== undefined
      ? parseMoney(input.monthlyAmount, "Amount", false)
      : existing.monthly_amount;
  const carryIn =
    input.carryIn !== undefined
      ? parseMoney(input.carryIn, "Already left over", true)
      : existing.carry_in;
  const startsOn =
    input.startsOn !== undefined ? assertYearMonth(input.startsOn) : existing.starts_on;
  const categoryId =
    input.categoryId !== undefined ? input.categoryId || null : existing.category_id;
  const accountId =
    input.accountId !== undefined ? parseAccountId(db, input.accountId) : existing.account_id;
  const schedule = normalizeSchedule({
    frequency:
      input.frequency !== undefined ? parseFrequency(input.frequency) : storedFrequency(existing.frequency),
    weekday:
      input.weekday !== undefined
        ? input.weekday
          ? parseWeekday(input.weekday)
          : null
        : storedWeekday(existing.weekday),
    anchorDate:
      input.anchorDate !== undefined ? input.anchorDate || null : existing.anchor_date,
    dueDay:
      input.dueDay !== undefined
        ? input.dueDay == null
          ? null
          : parseDueDay(input.dueDay)
        : storedDueDay(existing.due_day),
    startsOn,
  });

  if (categoryId !== existing.category_id || accountId !== existing.account_id) {
    assertCategoryAvailable(db, categoryId, accountId, id);
  }

  const stamp = nowIso();
  db.prepare(
    `
    UPDATE fixed_expenses SET
      name = ?, monthly_amount = ?, frequency = ?, weekday = ?, anchor_date = ?,
      category_id = ?, account_id = ?, due_day = ?, starts_on = ?, carry_in = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    name,
    monthlyAmount,
    schedule.frequency,
    schedule.weekday,
    schedule.anchorDate,
    categoryId,
    accountId,
    schedule.dueDay,
    schedule.startsOn,
    carryIn,
    stamp,
    id,
  );

  return mapExpense(getActive(db, id)!);
}

export function softDeleteFixedExpense(db: Db, id: string): boolean {
  const existing = getActive(db, id);
  if (!existing) return false;
  const stamp = nowIso();
  const result = db
    .prepare(
      `UPDATE fixed_expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(stamp, stamp, id);
  return result.changes > 0;
}

/**
 * Remove one month, this month and every month after it, or the whole expense.
 * Recorded payments stay on the accounts.
 */
export function removeFixedExpense(
  db: Db,
  id: string,
  scope: FixedExpenseRemoval,
  yearMonthInput: string,
): boolean {
  const expense = getActive(db, id);
  if (!expense) return false;
  if (scope === "all") return softDeleteFixedExpense(db, id);

  const yearMonth = assertYearMonth(yearMonthInput);
  if (yearMonth < expense.starts_on) throw new Error("That month is before this expense starts");
  if (expense.ends_on && yearMonth > expense.ends_on) {
    throw new Error("That month is after this expense ends");
  }

  if (scope === "future" && yearMonth <= expense.starts_on) {
    return softDeleteFixedExpense(db, id);
  }
  if (scope === "month") {
    omitMonth(db, id, yearMonth);
    return true;
  }
  db.prepare(`UPDATE fixed_expenses SET ends_on = ?, updated_at = ? WHERE id = ?`).run(
    shiftYearMonth(yearMonth, -1),
    nowIso(),
    id,
  );
  return true;
}

function omitMonth(db: Db, id: string, yearMonth: string): void {
  const existing = db
    .prepare(`SELECT * FROM fixed_expense_months WHERE fixed_expense_id = ? AND year_month = ?`)
    .get(id, yearMonth) as MonthRow | undefined;
  const stamp = nowIso();
  if (!existing) {
    db.prepare(
      `
      INSERT INTO fixed_expense_months
        (id, fixed_expense_id, year_month, planned_amount, paid_amount, omitted, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, 1, ?, ?)
    `,
    ).run(newId(), id, yearMonth, stamp, stamp);
    return;
  }
  db.prepare(`UPDATE fixed_expense_months SET omitted = 1, updated_at = ? WHERE id = ?`).run(
    stamp,
    existing.id,
  );
}

function loadOmittedMonths(db: Db, householdId: string): Map<string, string[]> {
  const rows = db
    .prepare(
      `
      SELECT m.fixed_expense_id, m.year_month
      FROM fixed_expense_months m
      JOIN fixed_expenses e ON e.id = m.fixed_expense_id
      WHERE e.household_id = ? AND e.deleted_at IS NULL AND m.omitted = 1
    `,
    )
    .all(householdId) as { fixed_expense_id: string; year_month: string }[];
  const omitted = new Map<string, string[]>();
  for (const row of rows) {
    const months = omitted.get(row.fixed_expense_id) ?? [];
    months.push(row.year_month);
    omitted.set(row.fixed_expense_id, months);
  }
  return omitted;
}

/**
 * Store a one-month plan or a hand-entered payment.
 * Override rows are worksheet values, so a cleared row is removed.
 */
export function setFixedExpenseMonth(
  db: Db,
  id: string,
  yearMonthInput: string,
  patch: FixedExpenseMonthPatch,
): boolean {
  const expense = getActive(db, id);
  if (!expense) return false;
  const yearMonth = assertYearMonth(yearMonthInput);
  if (yearMonth < expense.starts_on) {
    throw new Error("That month is before this expense starts");
  }

  const plannedPatch =
    patch.plannedAmount === undefined
      ? undefined
      : patch.plannedAmount === null
        ? null
        : parseMoney(patch.plannedAmount, "Planned amount", false);
  const paidPatch =
    patch.paidAmount === undefined
      ? undefined
      : patch.paidAmount === null
        ? null
        : parseMoney(patch.paidAmount, "Paid amount", true);

  const existing = db
    .prepare(
      `SELECT * FROM fixed_expense_months WHERE fixed_expense_id = ? AND year_month = ?`,
    )
    .get(id, yearMonth) as MonthRow | undefined;

  const planned = plannedPatch !== undefined ? plannedPatch : (existing?.planned_amount ?? null);
  const paid = paidPatch !== undefined ? paidPatch : (existing?.paid_amount ?? null);

  if (planned === null && paid === null && !existing?.omitted) {
    if (existing) {
      db.prepare(`DELETE FROM fixed_expense_months WHERE id = ?`).run(existing.id);
    }
    return true;
  }

  const stamp = nowIso();
  if (!existing) {
    db.prepare(
      `
      INSERT INTO fixed_expense_months
        (id, fixed_expense_id, year_month, planned_amount, paid_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(newId(), id, yearMonth, planned, paid, stamp, stamp);
    return true;
  }

  db.prepare(
    `
    UPDATE fixed_expense_months
    SET planned_amount = ?, paid_amount = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(planned, paid, stamp, existing.id);
  return true;
}

interface SalaryRow {
  id: string;
  household_id: string;
  name: string;
  weekly_amount: number;
  payday: string;
  anchor_date: string | null;
  starts_on: string;
  category_id: string | null;
  account_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapSalary(row: SalaryRow, rates: SalaryRate[] = []): Salary {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    amount: row.weekly_amount,
    rates,
    anchorDate: storedDate(row.anchor_date),
    startsOn: row.starts_on,
    categoryId: row.category_id,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function storedDate(value: string | null): string | null {
  if (!value) return null;
  try {
    return assertISODate(value);
  } catch {
    return null;
  }
}

function salaryTemplate(salary: Salary): SalaryTemplate {
  return {
    id: salary.id,
    name: salary.name,
    amount: salary.amount,
    anchorDate: salary.anchorDate,
    startsOn: salary.startsOn,
    categoryId: salary.categoryId,
    accountId: salary.accountId,
    rates: salary.rates,
  };
}

function loadSalaryRates(db: Db, householdId: string): Map<string, SalaryRate[]> {
  const rows = db
    .prepare(
      `
      SELECT r.salary_id, r.effective_on, r.amount
      FROM salary_rates r
      JOIN salaries s ON s.id = r.salary_id
      WHERE s.household_id = ? AND s.deleted_at IS NULL
      ORDER BY r.effective_on
    `,
    )
    .all(householdId) as { salary_id: string; effective_on: string; amount: number }[];
  const bySalary = new Map<string, SalaryRate[]>();
  for (const row of rows) {
    const list = bySalary.get(row.salary_id) ?? [];
    list.push({ effectiveOn: row.effective_on, amount: row.amount });
    bySalary.set(row.salary_id, list);
  }
  return bySalary;
}

function parseRates(value: unknown, startsOn: string): SalaryRate[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Salary changes must be a list");
  const rates: SalaryRate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("A salary change is incomplete");
    const record = item as { effectiveOn?: unknown; amount?: unknown };
    if (typeof record.effectiveOn !== "string") throw new Error("Pick the month a salary change starts");
    const effectiveOn = assertYearMonth(record.effectiveOn);
    if (effectiveOn < startsOn) {
      throw new Error("A salary change cannot start before the salary does");
    }
    if (seen.has(effectiveOn)) throw new Error("Two salary changes cannot start in the same month");
    seen.add(effectiveOn);
    rates.push({
      effectiveOn,
      amount: parseMoney(record.amount, "Paycheck amount", false),
    });
  }
  rates.sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn));
  return rates;
}

function replaceSalaryRates(db: Db, salaryId: string, rates: SalaryRate[]): void {
  const stamp = nowIso();
  db.prepare(`DELETE FROM salary_rates WHERE salary_id = ?`).run(salaryId);
  const insert = db.prepare(
    `
    INSERT INTO salary_rates (id, salary_id, effective_on, amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  );
  for (const rate of rates) {
    insert.run(newId(), salaryId, rate.effectiveOn, rate.amount, stamp, stamp);
  }
}

function loadSalaries(db: Db, householdId: string): SalaryTemplate[] {
  const rows = db
    .prepare(
      `SELECT * FROM salaries WHERE household_id = ? AND deleted_at IS NULL ORDER BY name`,
    )
    .all(householdId) as SalaryRow[];
  const rates = loadSalaryRates(db, householdId);
  return rows.map((row) => salaryTemplate(mapSalary(row, rates.get(row.id) ?? [])));
}

function getActiveSalary(db: Db, id: string): SalaryRow | null {
  const householdId = getHouseholdId(db);
  const row = db
    .prepare(
      `SELECT * FROM salaries WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
    )
    .get(id, householdId) as SalaryRow | undefined;
  return row ?? null;
}

function assertSalaryCategory(db: Db, categoryId: string | null): void {
  if (!categoryId) return;
  const categories = loadCategories(db);
  const category = categories.find((row) => row.id === categoryId);
  if (!category) throw new Error("Category not found");
  if (category.kind !== "income") {
    throw new Error("Link an income category so deposits count as received");
  }
}

/** Salaries whose categories overlap cannot each claim the same deposits. */
function sharedCategorySalaryIds(
  salaries: SalaryTemplate[],
  categories: CategoryNode[],
): Set<string> {
  const linked = salaries.filter((salary) => salary.categoryId);
  const shared = new Set<string>();
  for (let i = 0; i < linked.length; i += 1) {
    const left = linked[i];
    if (!left?.categoryId) continue;
    const leftIds = categoryTree(categories, left.categoryId);
    for (let j = i + 1; j < linked.length; j += 1) {
      const right = linked[j];
      if (!right?.categoryId) continue;
      const rightIds = categoryTree(categories, right.categoryId);
      let overlap = false;
      for (const id of leftIds) {
        if (rightIds.has(id)) {
          overlap = true;
          break;
        }
      }
      if (!overlap || !sameAccountScope(left.accountId, right.accountId)) continue;
      shared.add(left.id);
      shared.add(right.id);
    }
  }
  return shared;
}

function loadSalaryReceipts(
  db: Db,
  householdId: string,
  salaries: SalaryTemplate[],
  categories: CategoryNode[],
  yearMonth: string,
): SalaryReceipt[] {
  const linked = salaries.filter((salary) => salary.categoryId);
  if (linked.length === 0) return [];
  const { from, to } = monthBounds(yearMonth);
  const totals = db
    .prepare(
      `
      SELECT category_id, account_id, SUM(amount) AS total
      FROM transactions
      WHERE household_id = ?
        AND deleted_at IS NULL
        AND transfer_group_id IS NULL
        AND category_id IS NOT NULL
        AND date >= ?
        AND date <= ?
      GROUP BY category_id, account_id
    `,
    )
    .all(householdId, from, to) as { category_id: string; account_id: string; total: number }[];

  const receipts: SalaryReceipt[] = [];
  for (const salary of linked) {
    if (!salary.categoryId) continue;
    const ids = categoryTree(categories, salary.categoryId);
    let total = 0;
    for (const row of totals) {
      if (!ids.has(row.category_id)) continue;
      if (salary.accountId && row.account_id !== salary.accountId) continue;
      total += row.total;
    }
    receipts.push({ salaryId: salary.id, total: round2(total) });
  }
  return receipts;
}

function ratesForSalary(db: Db, salaryId: string): SalaryRate[] {
  const rows = db
    .prepare(
      `SELECT effective_on, amount FROM salary_rates WHERE salary_id = ? ORDER BY effective_on`,
    )
    .all(salaryId) as { effective_on: string; amount: number }[];
  return rows.map((row) => ({ effectiveOn: row.effective_on, amount: row.amount }));
}

function salarySchedule(anchorDate: string): { anchorDate: string; payday: Weekday } {
  const date = assertISODate(anchorDate);
  return { anchorDate: date, payday: weekdayOf(date) };
}

export function createSalary(db: Db, input: CreateSalaryInput): Salary {
  const name = parseName(input.name);
  const amount = parseMoney(input.amount, "Paycheck amount", false);
  if (!input.anchorDate) throw new Error("Pick a payday");
  const schedule = salarySchedule(input.anchorDate);
  const startsOn = assertYearMonth(input.startsOn);
  const categoryId = input.categoryId || null;
  const accountId = parseAccountId(db, input.accountId);
  assertSalaryCategory(db, categoryId);
  const rates = parseRates(input.rates, startsOn);

  const id = newId();
  const stamp = nowIso();
  const householdId = getHouseholdId(db);
  db.prepare(
    `
    INSERT INTO salaries
      (id, household_id, name, weekly_amount, payday, anchor_date, starts_on, category_id,
       account_id, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `,
  ).run(
    id,
    householdId,
    name,
    amount,
    schedule.payday,
    schedule.anchorDate,
    startsOn,
    categoryId,
    accountId,
    stamp,
    stamp,
  );
  replaceSalaryRates(db, id, rates);

  return mapSalary(getActiveSalary(db, id)!, rates);
}

export function updateSalary(db: Db, id: string, input: UpdateSalaryInput): Salary | null {
  const existing = getActiveSalary(db, id);
  if (!existing) return null;
  const current = mapSalary(existing, ratesForSalary(db, id));
  const name = input.name !== undefined ? parseName(input.name) : current.name;
  const amount =
    input.amount !== undefined
      ? parseMoney(input.amount, "Paycheck amount", false)
      : current.amount;
  const anchorDate =
    input.anchorDate !== undefined
      ? salarySchedule(input.anchorDate).anchorDate
      : current.anchorDate;
  if (!anchorDate) throw new Error("Pick a payday");
  const payday = weekdayOf(anchorDate);
  const startsOn = input.startsOn !== undefined ? assertYearMonth(input.startsOn) : current.startsOn;
  const categoryId =
    input.categoryId !== undefined ? input.categoryId || null : current.categoryId;
  const accountId =
    input.accountId !== undefined ? parseAccountId(db, input.accountId) : current.accountId;
  if (categoryId !== current.categoryId) assertSalaryCategory(db, categoryId);
  const rates = input.rates !== undefined ? parseRates(input.rates, startsOn) : current.rates;

  const stamp = nowIso();
  db.prepare(
    `
    UPDATE salaries SET
      name = ?, weekly_amount = ?, payday = ?, anchor_date = ?, starts_on = ?,
      category_id = ?, account_id = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(name, amount, payday, anchorDate, startsOn, categoryId, accountId, stamp, id);
  if (input.rates !== undefined) replaceSalaryRates(db, id, rates);
  return mapSalary(getActiveSalary(db, id)!, rates);
}

export function softDeleteSalary(db: Db, id: string): boolean {
  const existing = getActiveSalary(db, id);
  if (!existing) return false;
  const stamp = nowIso();
  const result = db
    .prepare(`UPDATE salaries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(stamp, stamp, id);
  return result.changes > 0;
}

export function exportFixedExpenses(db: Db): {
  fixedExpenses: FixedExpense[];
  fixedExpenseMonths: {
    id: string;
    fixedExpenseId: string;
    yearMonth: string;
    plannedAmount: number | null;
    paidAmount: number | null;
    omitted: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  salaries: Salary[];
} {
  const householdId = getHouseholdId(db);
  const expenses = db
    .prepare(
      `SELECT * FROM fixed_expenses WHERE household_id = ? AND deleted_at IS NULL ORDER BY name`,
    )
    .all(householdId) as FixedExpenseRow[];
  const months = db
    .prepare(
      `
      SELECT m.*
      FROM fixed_expense_months m
      JOIN fixed_expenses e ON e.id = m.fixed_expense_id
      WHERE e.household_id = ? AND e.deleted_at IS NULL
      ORDER BY m.year_month, e.name
    `,
    )
    .all(householdId) as MonthRow[];

  const salaries = db
    .prepare(
      `SELECT * FROM salaries WHERE household_id = ? AND deleted_at IS NULL ORDER BY name`,
    )
    .all(householdId) as SalaryRow[];
  const rates = loadSalaryRates(db, householdId);

  return {
    fixedExpenses: expenses.map(mapExpense),
    salaries: salaries.map((row) => mapSalary(row, rates.get(row.id) ?? [])),
    fixedExpenseMonths: months.map((row) => ({
      id: row.id,
      fixedExpenseId: row.fixed_expense_id,
      yearMonth: row.year_month,
      plannedAmount: row.planned_amount,
      paidAmount: row.paid_amount,
      omitted: row.omitted === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}
