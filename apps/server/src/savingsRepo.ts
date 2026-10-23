import {
  assertISODate,
  assertYearMonth,
  buildSavingsMonth,
  newId,
  nowIso,
  parseWeekday,
  round2,
  savingsRangesOverlap,
  shiftYearMonth,
  type CreateSavingsPlanInput,
  type SavingsFrequency,
  type SavingsMonth,
  type SavingsMonthRow,
  type PlannedInterval,
  type PlannedMonth,
  type SavingsAccountEntry,
  type SavingsPlan,
  type SavingsPlanRemoval,
  type SavingsPlanTemplate,
  type SavingsTransfer,
  type UpdateSavingsPlanInput,
  type Weekday,
} from "@pf/core";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";
import { listAccounts } from "./repo.js";

interface PlanRow {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  weekday: string | null;
  from_account_id: string;
  to_account_id: string;
  starts_on: string;
  ends_on: string | null;
  carry_in: number;
}

export function savingsMonth(db: Db, yearMonthInput: string): SavingsMonth & { rows: SavingsMonthRow[] } {
  const yearMonth = assertYearMonth(yearMonthInput);
  const plans = loadPlans(db);
  const built = buildSavingsMonth(yearMonth, plans, loadTransfers(db), loadAccountEntries(db));
  const names = new Map(listAccounts(db).map((account) => [account.id, account.name]));
  const rows: SavingsMonthRow[] = built.rows.map((row) => ({
    ...row,
    fromAccountName: names.get(row.fromAccountId) ?? "Account",
    toAccountName: names.get(row.toAccountId) ?? "Account",
  }));
  return { ...built, rows };
}

export function createSavingsPlan(db: Db, input: CreateSavingsPlanInput): SavingsPlan {
  const name = parseName(input.name);
  const amount = parseAmount(input.amount);
  const frequency = parseFrequency(input.frequency);
  const weekday = frequency === "weekly" ? parseWeekday(input.weekday) : null;
  const startsOn = assertYearMonth(input.startsOn);
  const fromAccountId = requireAccount(input.fromAccountId, "from");
  const toAccountId = requireAccount(input.toAccountId, "to");
  assertAccounts(db, fromAccountId, toAccountId, null, { startsOn, endsOn: null });

  const id = newId();
  const stamp = nowIso();
  db.prepare(
    `
    INSERT INTO savings_plans
      (id, household_id, name, amount, frequency, weekday, from_account_id, to_account_id,
       starts_on, carry_in, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
  `,
  ).run(
    id,
    getHouseholdId(db),
    name,
    amount,
    frequency,
    weekday,
    fromAccountId,
    toAccountId,
    startsOn,
    stamp,
    stamp,
  );
  if (input.monthAmounts) replaceMonthAmounts(db, id, startsOn, input.monthAmounts);
  if (input.intervals) replaceIntervals(db, id, startsOn, input.intervals);
  return mustPlan(db, id);
}

export function updateSavingsPlan(
  db: Db,
  id: string,
  input: UpdateSavingsPlanInput,
): SavingsPlan | null {
  const current = getPlan(db, id);
  if (!current) return null;
  const name = input.name !== undefined ? parseName(input.name) : current.name;
  const amount = input.amount !== undefined ? parseAmount(input.amount) : current.amount;
  const frequency = input.frequency !== undefined ? parseFrequency(input.frequency) : current.frequency;
  const weekday =
    frequency === "weekly"
      ? input.weekday !== undefined
        ? parseWeekday(input.weekday)
        : current.weekday
      : null;
  if (frequency === "weekly" && !weekday) throw new Error("Pick a day of the week");
  const fromAccountId =
    input.fromAccountId !== undefined ? requireAccount(input.fromAccountId, "from") : current.fromAccountId;
  const toAccountId =
    input.toAccountId !== undefined ? requireAccount(input.toAccountId, "to") : current.toAccountId;
  const endsOn = (
    db.prepare(`SELECT ends_on FROM savings_plans WHERE id = ?`).get(id) as { ends_on: string | null }
  ).ends_on;
  assertAccounts(db, fromAccountId, toAccountId, id, {
    startsOn: current.startsOn,
    endsOn,
  });

  db.prepare(
    `
    UPDATE savings_plans SET
      name = ?, amount = ?, frequency = ?, weekday = ?, from_account_id = ?, to_account_id = ?,
      updated_at = ?
    WHERE id = ?
  `,
  ).run(name, amount, frequency, weekday, fromAccountId, toAccountId, nowIso(), id);
  if (input.monthAmounts) replaceMonthAmounts(db, id, current.startsOn, input.monthAmounts);
  if (input.intervals) replaceIntervals(db, id, current.startsOn, input.intervals);
  return mustPlan(db, id);
}

export function softDeleteSavingsPlan(db: Db, id: string): boolean {
  const current = getPlan(db, id);
  if (!current) return false;
  const stamp = nowIso();
  const result = db
    .prepare(
      `UPDATE savings_plans SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(stamp, stamp, id);
  return result.changes > 0;
}

/**
 * Remove one month, this month and every month after it, or the whole objective.
 * Transfers already recorded stay in the accounts.
 */
export function removeSavingsPlan(
  db: Db,
  id: string,
  scope: SavingsPlanRemoval,
  yearMonthInput: string,
): boolean {
  const current = getPlan(db, id);
  if (!current) return false;
  if (scope === "all") return softDeleteSavingsPlan(db, id);

  const yearMonth = assertYearMonth(yearMonthInput);
  if (yearMonth < current.startsOn) throw new Error("That month is before this objective starts");
  const endsOn = db
    .prepare(`SELECT ends_on FROM savings_plans WHERE id = ?`)
    .get(id) as { ends_on: string | null };
  if (endsOn.ends_on && yearMonth > endsOn.ends_on) {
    throw new Error("That month is after this objective ends");
  }
  if (scope === "future" && yearMonth <= current.startsOn) return softDeleteSavingsPlan(db, id);
  if (scope === "month") {
    omitMonth(db, id, yearMonth);
    return true;
  }
  const endsOnMonth = shiftYearMonth(yearMonth, -1);
  db.prepare(`DELETE FROM savings_plan_months WHERE savings_plan_id = ? AND year_month >= ?`).run(
    id,
    yearMonth,
  );
  db.prepare(`UPDATE savings_plans SET ends_on = ?, updated_at = ? WHERE id = ?`).run(
    endsOnMonth,
    nowIso(),
    id,
  );
  return true;
}

function omitMonth(db: Db, id: string, yearMonth: string): void {
  const existing = db
    .prepare(`SELECT id FROM savings_plan_months WHERE savings_plan_id = ? AND year_month = ?`)
    .get(id, yearMonth) as { id: string } | undefined;
  const stamp = nowIso();
  if (!existing) {
    db.prepare(
      `
      INSERT INTO savings_plan_months
        (id, savings_plan_id, year_month, planned_amount, omitted, created_at, updated_at)
      VALUES (?, ?, ?, 0, 1, ?, ?)
    `,
    ).run(newId(), id, yearMonth, stamp, stamp);
    return;
  }
  db.prepare(`UPDATE savings_plan_months SET omitted = 1, updated_at = ? WHERE id = ?`).run(
    stamp,
    existing.id,
  );
}

export function listSavingsPlanTemplates(db: Db): SavingsPlanTemplate[] {
  return loadPlans(db);
}

function loadPlans(db: Db): SavingsPlanTemplate[] {
  const rows = db
    .prepare(
      `
      SELECT * FROM savings_plans
      WHERE household_id = ? AND deleted_at IS NULL
      ORDER BY name
    `,
    )
    .all(getHouseholdId(db)) as PlanRow[];
  const months = loadMonthAmounts(db);
  const omitted = loadOmittedMonths(db);
  const intervals = loadIntervals(db);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: row.amount,
    frequency: storedFrequency(row.frequency),
    weekday: storedWeekday(row.weekday),
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    carryIn: row.carry_in,
    monthAmounts: months.get(row.id) ?? [],
    omittedMonths: omitted.get(row.id) ?? [],
    intervals: intervals.get(row.id) ?? [],
  }));
}

function loadMonthAmounts(db: Db): Map<string, PlannedMonth[]> {
  const rows = db
    .prepare(
      `
      SELECT m.savings_plan_id, m.year_month, m.planned_amount
      FROM savings_plan_months m
      JOIN savings_plans p ON p.id = m.savings_plan_id
      WHERE p.household_id = ? AND p.deleted_at IS NULL AND m.omitted = 0
      ORDER BY m.year_month
    `,
    )
    .all(getHouseholdId(db)) as {
    savings_plan_id: string;
    year_month: string;
    planned_amount: number;
  }[];
  const months = new Map<string, PlannedMonth[]>();
  for (const row of rows) {
    const list = months.get(row.savings_plan_id) ?? [];
    list.push({ yearMonth: row.year_month, amount: row.planned_amount });
    months.set(row.savings_plan_id, list);
  }
  return months;
}

function loadOmittedMonths(db: Db): Map<string, string[]> {
  const rows = db
    .prepare(
      `
      SELECT m.savings_plan_id, m.year_month
      FROM savings_plan_months m
      JOIN savings_plans p ON p.id = m.savings_plan_id
      WHERE p.household_id = ? AND p.deleted_at IS NULL AND m.omitted = 1
      ORDER BY m.year_month
    `,
    )
    .all(getHouseholdId(db)) as { savings_plan_id: string; year_month: string }[];
  const omitted = new Map<string, string[]>();
  for (const row of rows) {
    const months = omitted.get(row.savings_plan_id) ?? [];
    months.push(row.year_month);
    omitted.set(row.savings_plan_id, months);
  }
  return omitted;
}

function replaceMonthAmounts(db: Db, planId: string, startsOn: string, months: PlannedMonth[]): void {
  const parsed = parseMonthAmounts(months);
  for (const month of parsed) {
    if (month.yearMonth < startsOn) throw new Error("That month is before this objective starts");
  }
  const stamp = nowIso();
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM savings_plan_months WHERE savings_plan_id = ? AND omitted = 0`).run(planId);
    const restore = db.prepare(
      `DELETE FROM savings_plan_months WHERE savings_plan_id = ? AND year_month = ?`,
    );
    const insert = db.prepare(
      `
      INSERT INTO savings_plan_months
        (id, savings_plan_id, year_month, planned_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    );
    for (const month of parsed) {
      restore.run(planId, month.yearMonth);
      insert.run(newId(), planId, month.yearMonth, month.amount, stamp, stamp);
    }
  });
  write();
}

function loadIntervals(db: Db): Map<string, PlannedInterval[]> {
  const rows = db
    .prepare(
      `
      SELECT m.savings_plan_id, m.from_date, m.to_date, m.amount
      FROM savings_plan_intervals m
      JOIN savings_plans p ON p.id = m.savings_plan_id
      WHERE p.household_id = ? AND p.deleted_at IS NULL
      ORDER BY m.from_date, m.to_date
    `,
    )
    .all(getHouseholdId(db)) as {
    savings_plan_id: string;
    from_date: string;
    to_date: string;
    amount: number;
  }[];
  const intervals = new Map<string, PlannedInterval[]>();
  for (const row of rows) {
    const list = intervals.get(row.savings_plan_id) ?? [];
    list.push({ from: row.from_date, to: row.to_date, amount: row.amount });
    intervals.set(row.savings_plan_id, list);
  }
  return intervals;
}

function replaceIntervals(db: Db, planId: string, startsOn: string, intervals: PlannedInterval[]): void {
  const parsed = parseIntervals(intervals, startsOn);
  const stamp = nowIso();
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM savings_plan_intervals WHERE savings_plan_id = ?`).run(planId);
    const insert = db.prepare(
      `
      INSERT INTO savings_plan_intervals
        (id, savings_plan_id, from_date, to_date, amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    );
    for (const interval of parsed) {
      insert.run(newId(), planId, interval.from, interval.to, interval.amount, stamp, stamp);
    }
  });
  write();
}

function parseIntervals(value: PlannedInterval[], startsOn: string): PlannedInterval[] {
  if (!Array.isArray(value)) throw new Error("Date ranges must be a list");
  const intervals: PlannedInterval[] = [];
  for (const item of value) {
    const record = item as { from?: unknown; to?: unknown; amount?: unknown };
    const from = assertISODate(typeof record.from === "string" ? record.from : "");
    const to = assertISODate(typeof record.to === "string" ? record.to : "");
    if (from > to) throw new Error("The end date is before the start date");
    if (from < `${startsOn}-01`) throw new Error("That date is before this objective starts");
    const amount = typeof record.amount === "number" ? record.amount : Number(record.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Planned amount cannot be negative");
    intervals.push({ from, to, amount: round2(amount) });
  }
  intervals.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (previous && current && current.from <= previous.to) {
      throw new Error("Date ranges cannot overlap");
    }
  }
  return intervals;
}

function parseMonthAmounts(value: PlannedMonth[]): PlannedMonth[] {
  if (!Array.isArray(value)) throw new Error("Month amounts must be a list");
  const seen = new Set<string>();
  const months: PlannedMonth[] = [];
  for (const item of value) {
    const record = item as { yearMonth?: unknown; amount?: unknown };
    const yearMonth = assertYearMonth(typeof record.yearMonth === "string" ? record.yearMonth : "");
    if (seen.has(yearMonth)) throw new Error("Two amounts cannot apply to the same month");
    seen.add(yearMonth);
    const amount = typeof record.amount === "number" ? record.amount : Number(record.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Planned amount cannot be negative");
    months.push({ yearMonth, amount: round2(amount) });
  }
  months.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return months;
}

/** Register entries on a savings or placement account that are not transfers. */
export function loadAccountEntries(db: Db): SavingsAccountEntry[] {
  const rows = db
    .prepare(
      `
      SELECT t.account_id, t.date, t.amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.household_id = ?
        AND t.deleted_at IS NULL
        AND t.transfer_group_id IS NULL
        AND a.deleted_at IS NULL
        AND a.type IN ('savings', 'placement')
    `,
    )
    .all(getHouseholdId(db)) as { account_id: string; date: string; amount: number }[];
  return rows.map((row) => ({
    accountId: row.account_id,
    date: row.date,
    amount: row.amount,
  }));
}

/** One row per transfer. The objective counts every deposit into its account. */
export function loadTransfers(db: Db): SavingsTransfer[] {
  const rows = db
    .prepare(
      `
      SELECT transfer_group_id, account_id, date, amount
      FROM transactions
      WHERE household_id = ? AND deleted_at IS NULL AND transfer_group_id IS NOT NULL
    `,
    )
    .all(getHouseholdId(db)) as {
    transfer_group_id: string;
    account_id: string;
    date: string;
    amount: number;
  }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const legs = groups.get(row.transfer_group_id) ?? [];
    legs.push(row);
    groups.set(row.transfer_group_id, legs);
  }
  const transfers: SavingsTransfer[] = [];
  for (const legs of groups.values()) {
    const from = legs.find((leg) => leg.amount < 0);
    const to = legs.find((leg) => leg.amount > 0);
    if (!from || !to) continue;
    transfers.push({
      date: from.date,
      fromAccountId: from.account_id,
      toAccountId: to.account_id,
      amount: round2(Math.abs(from.amount)),
    });
  }
  return transfers;
}

function assertAccounts(
  db: Db,
  fromAccountId: string,
  toAccountId: string,
  exceptId: string | null,
  range: { startsOn: string; endsOn: string | null },
): void {
  if (fromAccountId === toAccountId) throw new Error("Pick two different accounts");
  const accounts = listAccounts(db);
  const from = accounts.find((account) => account.id === fromAccountId);
  const to = accounts.find((account) => account.id === toAccountId);
  if (!from || !to) throw new Error("Account not found");
  if (from.type !== "checking" && from.type !== "cash") {
    throw new Error("Move savings from a chequing or cash account");
  }
  if (to.type !== "savings" && to.type !== "placement") {
    throw new Error("The objective has to land in savings or a placement");
  }
  const others = db
    .prepare(
      `
      SELECT starts_on, ends_on FROM savings_plans
      WHERE household_id = ? AND to_account_id = ? AND deleted_at IS NULL AND id != ?
    `,
    )
    .all(getHouseholdId(db), toAccountId, exceptId ?? "") as {
    starts_on: string;
    ends_on: string | null;
  }[];
  const clash = others.find((other) =>
    savingsRangesOverlap(range, { startsOn: other.starts_on, endsOn: other.ends_on }),
  );
  if (!clash) return;
  const through = clash.ends_on ? ` through ${monthLabel(clash.ends_on)}` : "";
  throw new Error(`${to.name} already has a savings objective${through}`);
}

function monthLabel(yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleString("en-CA", { month: "long", year: "numeric" });
}

function getPlan(db: Db, id: string): SavingsPlan | null {
  const row = db
    .prepare(
      `SELECT * FROM savings_plans WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
    )
    .get(id, getHouseholdId(db)) as PlanRow | undefined;
  return row ? mapPlan(row) : null;
}

function mustPlan(db: Db, id: string): SavingsPlan {
  const plan = getPlan(db, id);
  if (!plan) throw new Error("Savings objective not found");
  return plan;
}

function mapPlan(row: PlanRow): SavingsPlan {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    frequency: storedFrequency(row.frequency),
    weekday: storedWeekday(row.weekday),
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    startsOn: row.starts_on,
    carryIn: row.carry_in,
  };
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Name is required");
  return value.trim();
}

function parseAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero");
  return round2(amount);
}

function parseFrequency(value: unknown): SavingsFrequency {
  if (value === "weekly" || value === "monthly") return value;
  throw new Error("Pick weekly or monthly");
}

function requireAccount(value: unknown, side: "from" | "to"): string {
  if (typeof value !== "string" || !value) {
    throw new Error(side === "from" ? "Pick the account the money leaves" : "Pick where the money lands");
  }
  return value;
}

function storedFrequency(value: string): SavingsFrequency {
  return value === "weekly" ? "weekly" : "monthly";
}

function storedWeekday(value: string | null): Weekday | null {
  if (!value) return null;
  return parseWeekday(value);
}
