import type { AccountType } from "./types.js";
import type { FixedExpenseMonthAdjustment } from "./budget.js";
import {
  addDays,
  assertISODate,
  dateOnDay,
  paycheckAmount,
  weekdayOf,
  type PayFrequency,
  type SalaryTemplate,
  type Weekday,
} from "./schedule.js";
import { round2 } from "./spend.js";

export interface WeekAccount {
  id: string;
  name: string;
  type: AccountType;
  /** Balance now, including transactions already entered. */
  balance: number;
}

export interface WeekMovement {
  accountId: string;
  date: string;
  amount: number;
  categoryId: string | null;
  transfer: boolean;
}

export interface WeekBill {
  id: string;
  name: string;
  /** Amount of one occurrence. */
  amount: number;
  frequency: PayFrequency;
  weekday: Weekday | null;
  anchorDate: string | null;
  startsOn: string;
  categoryId: string | null;
  accountId: string | null;
  /** Day of month for a monthly bill, taken from the last payment. */
  dueDay: number | null;
  /** Last month the bill still repeats. Empty means it keeps repeating. */
  endsOn?: string | null;
  /** Months removed from the series. */
  omittedMonths?: string[];
}

export interface WeekForecastInput {
  /** Local calendar date the forecast starts on, YYYY-MM-DD. */
  today: string;
  /** Length of the window, including today. Defaults to 7. */
  days?: number;
  accounts: WeekAccount[];
  salaries: SalaryTemplate[];
  bills: WeekBill[];
  movements: WeekMovement[];
  adjustments?: FixedExpenseMonthAdjustment[];
}

export interface WeekForecastItem {
  date: string;
  kind: "income" | "expense";
  name: string;
  amount: number;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  /** Already entered on the register, so the current balance includes it. */
  recorded: boolean;
  /** Account balance after this item. Null when it is already recorded or has no account. */
  balanceAfter: number | null;
}

export interface WeekAccountForecast {
  accountId: string;
  name: string;
  type: AccountType;
  balance: number;
  lowest: number;
  projected: number;
  /** First day the running balance is below zero. */
  shortOn: string | null;
  shortfall: number;
  alert: boolean;
}

export interface WeekForecast {
  from: string;
  to: string;
  items: WeekForecastItem[];
  accounts: WeekAccountForecast[];
}

const DEFAULT_DAYS = 7;

/**
 * Cash due over the next days, starting today.
 * Paychecks follow the 14-day salary dates. Bills follow their weekly,
 * bi-weekly, or monthly due day. Something already on the register is not
 * applied again. An account alerts when its running balance goes below zero.
 * Credit accounts are left out of that check.
 */
export function buildWeekForecast(input: WeekForecastInput): WeekForecast {
  const from = assertISODate(input.today);
  const days = clampDays(input.days);
  const to = addDays(from, days - 1);
  const names = new Map(input.accounts.map((account) => [account.id, account.name]));
  const adjustments = input.adjustments ?? [];

  const scheduled: WeekForecastItem[] = [];
  for (const salary of input.salaries) {
    if (!salary.anchorDate) continue;
    for (const date of cadenceDates(salary.anchorDate, from, to, 14, true)) {
      if (date.slice(0, 7) < salary.startsOn) continue;
      scheduled.push({
        date,
        kind: "income",
        name: salary.name,
        amount: paycheckAmount(salary.amount, salary.rates, date),
        accountId: salary.accountId,
        accountName: salary.accountId ? (names.get(salary.accountId) ?? null) : null,
        categoryId: salary.categoryId,
        recorded: false,
        balanceAfter: null,
      });
    }
  }

  for (const bill of input.bills) {
    for (const date of billDates(bill, from, to)) {
      const override = adjustments.find(
        (row) => row.fixedExpenseId === bill.id && row.yearMonth === date.slice(0, 7),
      );
      const amount =
        bill.frequency === "monthly" && override?.plannedAmount != null
          ? round2(override.plannedAmount)
          : round2(bill.amount);
      scheduled.push({
        date,
        kind: "expense",
        name: bill.name,
        amount,
        accountId: bill.accountId,
        accountName: bill.accountId ? (names.get(bill.accountId) ?? null) : null,
        categoryId: bill.categoryId,
        recorded: false,
        balanceAfter: null,
      });
    }
  }

  scheduled.sort(compareItems);
  const unused = input.movements.filter((movement) => !movement.transfer);
  for (const item of scheduled) {
    const index = unused.findIndex((movement) => matchesRecorded(item, movement));
    if (index < 0) continue;
    unused.splice(index, 1);
    item.recorded = true;
  }

  const running = new Map(input.accounts.map((account) => [account.id, round2(account.balance)]));
  const lowest = new Map(running);
  const shortOn = new Map<string, string | null>();
  for (const account of input.accounts) {
    shortOn.set(account.id, account.balance < 0 ? from : null);
  }

  for (const item of scheduled) {
    if (item.recorded || !item.accountId || !running.has(item.accountId)) continue;
    const next = round2(
      (running.get(item.accountId) ?? 0) + (item.kind === "income" ? item.amount : -item.amount),
    );
    running.set(item.accountId, next);
    item.balanceAfter = next;
    const floor = lowest.get(item.accountId) ?? next;
    if (next < floor) {
      lowest.set(item.accountId, next);
      if (next < 0 && shortOn.get(item.accountId) == null) shortOn.set(item.accountId, item.date);
    }
  }

  const accounts: WeekAccountForecast[] = input.accounts.map((account) => {
    const low = round2(lowest.get(account.id) ?? account.balance);
    const alert = account.type !== "credit" && low < 0;
    return {
      accountId: account.id,
      name: account.name,
      type: account.type,
      balance: round2(account.balance),
      lowest: low,
      projected: round2(running.get(account.id) ?? account.balance),
      shortOn: alert ? (shortOn.get(account.id) ?? null) : null,
      shortfall: alert ? round2(-low) : 0,
      alert,
    };
  });

  return { from, to, items: scheduled, accounts };
}

function billDates(bill: WeekBill, from: string, to: string): string[] {
  if (bill.frequency === "weekly") {
    if (!bill.weekday) return [];
    const dates: string[] = [];
    let cursor = from;
    while (cursor <= to) {
      if (billCovers(bill, cursor) && weekdayOf(cursor) === bill.weekday) dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }
  if (bill.frequency === "biweekly") {
    if (!bill.anchorDate) return [];
    return cadenceDates(bill.anchorDate, from, to, 14, false).filter((date) => billCovers(bill, date));
  }
  if (bill.dueDay == null) return [];
  const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
  const dates: string[] = [];
  for (const yearMonth of months) {
    if (!billCovers(bill, `${yearMonth}-01`)) continue;
    const date = dateOnDay(yearMonth, bill.dueDay);
    if (date >= from && date <= to) dates.push(date);
  }
  return dates;
}

function billCovers(bill: WeekBill, date: string): boolean {
  const yearMonth = date.slice(0, 7);
  if (yearMonth < bill.startsOn) return false;
  if (bill.endsOn && yearMonth > bill.endsOn) return false;
  return !bill.omittedMonths?.includes(yearMonth);
}

function cadenceDates(
  anchor: string,
  from: string,
  to: string,
  step: number,
  allowBeforeAnchor: boolean,
): string[] {
  let cursor = assertISODate(anchor);
  let guard = 0;
  while (cursor > from && guard < 4000) {
    const previous = addDays(cursor, -step);
    if (!allowBeforeAnchor && previous < anchor) break;
    if (previous < from) break;
    cursor = previous;
    guard += 1;
  }
  while (cursor < from && guard < 4000) {
    const next = addDays(cursor, step);
    if (!allowBeforeAnchor && next < anchor) break;
    cursor = next;
    guard += 1;
  }
  const dates: string[] = [];
  while (cursor <= to && guard < 4000) {
    if ((allowBeforeAnchor || cursor >= anchor) && cursor >= from) dates.push(cursor);
    cursor = addDays(cursor, step);
    guard += 1;
  }
  return dates;
}

function matchesRecorded(item: WeekForecastItem, movement: WeekMovement): boolean {
  if (movement.date !== item.date) return false;
  if (item.accountId && movement.accountId !== item.accountId) return false;
  const incoming = movement.amount > 0;
  if (item.kind === "income" && !incoming) return false;
  if (item.kind === "expense" && incoming) return false;
  if (item.categoryId && movement.categoryId === item.categoryId) return true;
  const expected = item.kind === "income" ? item.amount : -item.amount;
  return Math.abs(movement.amount - expected) < 0.001;
}

function compareItems(a: WeekForecastItem, b: WeekForecastItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
  return a.name.localeCompare(b.name, "en-CA");
}

function clampDays(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.min(31, Math.max(1, Math.floor(value)));
}
