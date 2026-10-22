import {
  assertYearMonth,
  buildSavingsMonth,
  newId,
  nowIso,
  parseWeekday,
  round2,
  type CreateSavingsPlanInput,
  type SavingsFrequency,
  type SavingsMonth,
  type SavingsMonthRow,
  type SavingsPlan,
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
  carry_in: number;
}

export function savingsMonth(db: Db, yearMonthInput: string): SavingsMonth & { rows: SavingsMonthRow[] } {
  const yearMonth = assertYearMonth(yearMonthInput);
  const plans = loadPlans(db);
  const built = buildSavingsMonth(yearMonth, plans, loadTransfers(db));
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
  assertAccounts(db, fromAccountId, toAccountId, null);

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
  assertAccounts(db, fromAccountId, toAccountId, id);

  db.prepare(
    `
    UPDATE savings_plans SET
      name = ?, amount = ?, frequency = ?, weekday = ?, from_account_id = ?, to_account_id = ?,
      updated_at = ?
    WHERE id = ?
  `,
  ).run(name, amount, frequency, weekday, fromAccountId, toAccountId, nowIso(), id);
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
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: row.amount,
    frequency: storedFrequency(row.frequency),
    weekday: storedWeekday(row.weekday),
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    startsOn: row.starts_on,
    carryIn: row.carry_in,
  }));
}

function loadTransfers(db: Db): SavingsTransfer[] {
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

function assertAccounts(db: Db, fromAccountId: string, toAccountId: string, exceptId: string | null): void {
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
  const clash = db
    .prepare(
      `
      SELECT id FROM savings_plans
      WHERE household_id = ? AND to_account_id = ? AND deleted_at IS NULL AND id != ?
    `,
    )
    .get(getHouseholdId(db), toAccountId, exceptId ?? "") as { id: string } | undefined;
  if (clash) throw new Error(`${to.name} already has a savings objective`);
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
