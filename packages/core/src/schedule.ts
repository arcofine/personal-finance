import { monthBounds, round2 } from "./spend.js";

export type PayFrequency = "weekly" | "biweekly" | "monthly";

export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/** Monday-first, for a Canadian household. */
export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const INDEX_WEEKDAY: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function weekdayName(day: Weekday): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

export function frequencyName(frequency: PayFrequency): string {
  if (frequency === "weekly") return "Weekly";
  if (frequency === "biweekly") return "Bi-weekly";
  return "Monthly";
}

export function parseWeekday(value: unknown): Weekday {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, value)) {
    return value as Weekday;
  }
  throw new Error("Pick a day of the week");
}

export function assertISODate(value: string): string {
  const parts = readISODate(value);
  if (!parts) throw new Error("Date must be YYYY-MM-DD");
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    throw new Error("Date must be YYYY-MM-DD");
  }
  return value;
}

export function addDays(iso: string, days: number): string {
  const parts = readISODate(assertISODate(iso));
  if (!parts) throw new Error("Date must be YYYY-MM-DD");
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatUTC(date);
}

export function weekdayOf(iso: string): Weekday {
  const parts = readISODate(assertISODate(iso));
  if (!parts) throw new Error("Date must be YYYY-MM-DD");
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = INDEX_WEEKDAY[date.getUTCDay()];
  if (!day) throw new Error("Date must be YYYY-MM-DD");
  return day;
}

export interface OccurrenceSet {
  count: number;
  dates: string[];
}

/**
 * How many times a weekly, bi-weekly, or monthly item lands in a calendar month.
 * Weekly uses a weekday. Bi-weekly uses an anchor date and steps 14 days.
 */
export function occurrencesFor(
  yearMonth: string,
  frequency: PayFrequency,
  weekday: Weekday | null,
  anchorDate: string | null,
  dueDay: number | null = null,
): OccurrenceSet {
  if (frequency === "monthly") {
    if (dueDay == null) return { count: 1, dates: [] };
    return { count: 1, dates: [dateOnDay(yearMonth, dueDay)] };
  }
  if (frequency === "weekly") {
    if (!weekday) return { count: 0, dates: [] };
    return weekdaysInMonth(yearMonth, weekday);
  }
  if (!anchorDate) return { count: 0, dates: [] };
  return biweeklyInMonth(yearMonth, anchorDate);
}

export function weekdaysInMonth(yearMonth: string, weekday: Weekday): OccurrenceSet {
  const { from, to } = monthBounds(yearMonth);
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (weekdayOf(cursor) === weekday) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return { count: dates.length, dates };
}

/** The due day inside a month, clamped to the last day of a short month. */
export function dateOnDay(yearMonth: string, dueDay: number): string {
  const last = Number(monthBounds(yearMonth).to.slice(8, 10));
  const day = Math.min(last, Math.max(1, Math.floor(dueDay)));
  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

function biweeklyInMonth(yearMonth: string, anchorDate: string): OccurrenceSet {
  const anchor = assertISODate(anchorDate);
  const { from, to } = monthBounds(yearMonth);
  if (anchor > to) return { count: 0, dates: [] };

  let cursor = anchor;
  if (cursor < from) {
    const steps = Math.floor(daysBetween(anchor, from) / 14);
    cursor = addDays(anchor, steps * 14);
    if (cursor < from) cursor = addDays(cursor, 14);
  }

  const dates: string[] = [];
  let guard = 0;
  while (cursor <= to && guard < 8) {
    guard += 1;
    if (cursor >= from) dates.push(cursor);
    cursor = addDays(cursor, 14);
  }
  return { count: dates.length, dates };
}

/**
 * Every payday in the month on a 14-day cadence.
 * The anchor can be any payday, including one later in the year.
 * Dates before the anchor still count, unlike a bill that starts on its first due date.
 */
export function biweeklyPaydaysInMonth(yearMonth: string, anchorDate: string): OccurrenceSet {
  const anchor = assertISODate(anchorDate);
  const { from, to } = monthBounds(yearMonth);

  let cursor = anchor;
  if (cursor < from) {
    const steps = Math.floor(daysBetween(cursor, from) / 14);
    cursor = addDays(cursor, steps * 14);
    if (cursor < from) cursor = addDays(cursor, 14);
  } else if (cursor > from) {
    const steps = Math.floor(daysBetween(from, cursor) / 14);
    cursor = addDays(cursor, -steps * 14);
    if (cursor < from) cursor = addDays(cursor, 14);
  }

  const dates: string[] = [];
  let guard = 0;
  while (cursor <= to && guard < 6) {
    guard += 1;
    if (cursor >= from) dates.push(cursor);
    cursor = addDays(cursor, 14);
  }
  return { count: dates.length, dates };
}

export interface SalaryRate {
  /** First month this paycheck amount applies, YYYY-MM. It stays until the next change. */
  effectiveOn: string;
  amount: number;
}

export interface SalaryTemplate {
  id: string;
  name: string;
  /** Paycheck amount from startsOn until the first change. */
  amount: number;
  rates: SalaryRate[];
  /** Any known payday. The other paydays fall every 14 days from this date. */
  anchorDate: string | null;
  startsOn: string;
  categoryId: string | null;
  /** Account the paycheck is deposited into. Empty counts every account. */
  accountId: string | null;
}

export interface SalaryReceipt {
  salaryId: string;
  /** Signed category total for the month. Positive is money in. */
  total: number;
}

export type ReceivedSource = "category" | "shared" | "none";

export interface SalaryMonthCalc {
  id: string;
  name: string;
  /** Starting paycheck, before any dated change. */
  amount: number;
  rates: SalaryRate[];
  anchorDate: string | null;
  startsOn: string;
  categoryId: string | null;
  accountId: string | null;
  occurrences: number;
  dates: string[];
  /** Amount of each payday in this month, in the same order as dates. */
  payAmounts: number[];
  expected: number;
  received: number;
  receivedSource: ReceivedSource;
}

export interface SalaryMonthRow extends SalaryMonthCalc {
  categoryName: string | null;
  accountName: string | null;
}

export interface Salary {
  id: string;
  householdId: string;
  name: string;
  amount: number;
  rates: SalaryRate[];
  anchorDate: string | null;
  startsOn: string;
  categoryId: string | null;
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateSalaryInput {
  name: string;
  amount: number;
  anchorDate: string;
  startsOn: string;
  categoryId?: string | null;
  accountId?: string | null;
  rates?: SalaryRate[];
}

export interface UpdateSalaryInput {
  name?: string;
  amount?: number;
  anchorDate?: string;
  startsOn?: string;
  categoryId?: string | null;
  accountId?: string | null;
  rates?: SalaryRate[];
}

/** Paycheck in effect on a date. A change applies from its month until the next one. */
export function paycheckAmount(
  base: number,
  rates: readonly SalaryRate[] | undefined,
  isoDate: string,
): number {
  const month = isoDate.slice(0, 7);
  let amount = base;
  let from = "";
  for (const rate of rates ?? []) {
    if (rate.effectiveOn <= month && rate.effectiveOn >= from) {
      amount = rate.amount;
      from = rate.effectiveOn;
    }
  }
  return round2(amount);
}

/** Expected salary sums each payday at the amount in effect that month. */
export function buildSalaryMonth(
  yearMonth: string,
  salaries: SalaryTemplate[],
  receipts: SalaryReceipt[],
): SalaryMonthCalc[] {
  const receivedById = new Map(receipts.map((row) => [row.salaryId, row.total]));
  const rows: SalaryMonthCalc[] = [];

  for (const salary of salaries) {
    if (salary.startsOn > yearMonth) continue;
    const occurrence = salary.anchorDate
      ? biweeklyPaydaysInMonth(yearMonth, salary.anchorDate)
      : { count: 0, dates: [] as string[] };
    const linked = salary.categoryId != null;
    const payAmounts = occurrence.dates.map((date) =>
      paycheckAmount(salary.amount, salary.rates, date),
    );
    rows.push({
      id: salary.id,
      name: salary.name,
      amount: round2(salary.amount),
      rates: [...(salary.rates ?? [])].sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn)),
      anchorDate: salary.anchorDate,
      startsOn: salary.startsOn,
      categoryId: salary.categoryId,
      accountId: salary.accountId,
      occurrences: occurrence.count,
      dates: occurrence.dates,
      payAmounts,
      expected: round2(payAmounts.reduce((sum, amount) => sum + amount, 0)),
      received: linked ? round2(receivedById.get(salary.id) ?? 0) : 0,
      receivedSource: linked ? "category" : "none",
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  return rows;
}

function readISODate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (!yearText || !monthText || !dayText) return null;
  return { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
}

function formatUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  const start = readISODate(from);
  const end = readISODate(to);
  if (!start || !end) throw new Error("Date must be YYYY-MM-DD");
  const a = Date.UTC(start.year, start.month - 1, start.day);
  const b = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((b - a) / 86400000);
}
