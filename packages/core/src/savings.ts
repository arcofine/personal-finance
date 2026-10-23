import type { Weekday } from "./schedule.js";
import { occurrencesFor } from "./schedule.js";
import { assertYearMonth, shiftYearMonth, type PlannedMonth } from "./budget.js";
import { monthBounds, round2 } from "./spend.js";

export type SavingsFrequency = "weekly" | "monthly";

/** Amount for each usual day inside an inclusive set of dates. Other days keep the usual amount. */
export interface PlannedInterval {
  from: string;
  to: string;
  amount: number;
}

export interface SavingsPlanTemplate {
  id: string;
  name: string;
  /** Amount of one weekly transfer, or the monthly amount. */
  amount: number;
  frequency: SavingsFrequency;
  weekday: Weekday | null;
  fromAccountId: string;
  toAccountId: string;
  startsOn: string;
  /** Last month that still has this objective. Later months are gone. */
  endsOn?: string | null;
  /** Months removed from the series. Earlier and later months stay. */
  omittedMonths?: string[];
  /** Unmet objective already owed before `startsOn`. Negative means ahead. */
  carryIn: number;
  /** Per-occurrence amounts that replace the usual amount for those months only. */
  monthAmounts?: PlannedMonth[];
  /** Per-occurrence amounts for the dates they cover. */
  intervals?: PlannedInterval[];
}

/** A real transfer between two accounts. Amount is positive. */
export interface SavingsTransfer {
  date: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
}

/**
 * A register entry on the savings or placement account that is not a transfer.
 * Amount is signed: positive increases the account.
 */
export interface SavingsAccountEntry {
  accountId: string;
  date: string;
  amount: number;
}

export interface SavingsPlanMonthCalc {
  id: string;
  name: string;
  amount: number;
  frequency: SavingsFrequency;
  weekday: Weekday | null;
  fromAccountId: string;
  toAccountId: string;
  startsOn: string;
  occurrences: number;
  broughtForward: number;
  planned: number;
  /** True when this month uses its own planned total instead of the usual amount. */
  plannedOverridden: boolean;
  /** Every one-month plan, including months other than the one being viewed. */
  monthAmounts: PlannedMonth[];
  /** Every date range on this objective, including ranges outside the viewed month. */
  intervals: PlannedInterval[];
  /** True when a date range changes this month and no whole-month total replaces it. */
  customDates: boolean;
  /** Net recorded in the destination. A transfer or other money leaving reduces it. */
  saved: number;
  /** broughtForward + planned − saved. Positive is still to set aside. */
  remaining: number;
}

export interface SavingsMonthRow extends SavingsPlanMonthCalc {
  fromAccountName: string;
  toAccountName: string;
}

export interface SavingsMonthTotals {
  planned: number;
  saved: number;
  remaining: number;
}

export interface SavingsMonth {
  yearMonth: string;
  rows: SavingsPlanMonthCalc[];
  totals: SavingsMonthTotals;
}

export interface CreateSavingsPlanInput {
  name: string;
  amount: number;
  frequency: SavingsFrequency;
  weekday?: Weekday | null;
  fromAccountId: string;
  toAccountId: string;
  startsOn: string;
  /** Per-occurrence amounts for those months only. */
  monthAmounts?: PlannedMonth[];
  /** Per-occurrence amounts for the dates they cover. Omit to leave them alone. */
  intervals?: PlannedInterval[];
}

export interface UpdateSavingsPlanInput {
  name?: string;
  amount?: number;
  frequency?: SavingsFrequency;
  weekday?: Weekday | null;
  fromAccountId?: string;
  toAccountId?: string;
  /** Replaces every one-month plan. Omit it to leave those months alone. */
  monthAmounts?: PlannedMonth[];
  /** Replaces every date range. Omit it to leave those ranges alone. */
  intervals?: PlannedInterval[];
}

export interface SavingsPlan {
  id: string;
  name: string;
  amount: number;
  frequency: SavingsFrequency;
  weekday: Weekday | null;
  fromAccountId: string;
  toAccountId: string;
  startsOn: string;
  carryIn: number;
}

export type SavingsPlanRemoval = "month" | "future" | "all";

/**
 * Project each savings objective through `yearMonth`.
 * The plan repeats weekly or monthly. Any transfer into the destination
 * counts as saved, whichever account it left, and so does other money
 * recorded directly on that account. Money leaving the destination sets the
 * objective back. What is still to save carries into the next month.
 */
export function buildSavingsMonth(
  yearMonth: string,
  plans: SavingsPlanTemplate[],
  transfers: SavingsTransfer[],
  entries: SavingsAccountEntry[] = [],
): SavingsMonth {
  assertYearMonth(yearMonth);
  const rows: SavingsPlanMonthCalc[] = [];
  for (const plan of plans) {
    if (!savingsMonthIsOpen(plan, yearMonth)) continue;
    rows.push(projectPlan(plan, yearMonth, transfers, entries));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  return { yearMonth, rows, totals: sumTotals(rows) };
}

function projectPlan(
  plan: SavingsPlanTemplate,
  yearMonth: string,
  transfers: SavingsTransfer[],
  entries: SavingsAccountEntry[],
): SavingsPlanMonthCalc {
  assertYearMonth(plan.startsOn);
  let brought = round2(plan.carryIn);
  let cursor = plan.startsOn;
  let guard = 0;
  while (cursor < yearMonth) {
    if (guard++ > 600) throw new Error("Savings history is too long to roll forward");
    if (savingsMonthIsOpen(plan, cursor)) {
      brought = round2(
        brought + plannedAmount(plan, cursor) - savedInMonth(plan, cursor, transfers, entries),
      );
    }
    cursor = shiftYearMonth(cursor, 1);
  }
  const planned = plannedAmount(plan, yearMonth);
  const saved = savedInMonth(plan, yearMonth, transfers, entries);
  return {
    id: plan.id,
    name: plan.name,
    amount: round2(plan.amount),
    frequency: plan.frequency,
    weekday: plan.weekday,
    fromAccountId: plan.fromAccountId,
    toAccountId: plan.toAccountId,
    startsOn: plan.startsOn,
    occurrences: occurrencesFor(yearMonth, plan.frequency, plan.weekday, null).count,
    broughtForward: brought,
    planned,
    plannedOverridden: monthAmount(plan, yearMonth) != null,
    monthAmounts: [...(plan.monthAmounts ?? [])].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    intervals: [...(plan.intervals ?? [])].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    customDates: usesCustomDates(plan, yearMonth),
    saved,
    remaining: round2(brought + planned - saved),
  };
}

function plannedAmount(plan: SavingsPlanTemplate, yearMonth: string): number {
  return round2(
    savingsOccurrenceAmounts(plan, yearMonth).reduce((sum, item) => sum + item.amount, 0),
  );
}

/** Two objectives for one account overlap when neither has ended before the other starts. */
export function savingsRangesOverlap(
  left: { startsOn: string; endsOn?: string | null },
  right: { startsOn: string; endsOn?: string | null },
): boolean {
  const leftEnded = left.endsOn != null && left.endsOn < right.startsOn;
  const rightEnded = right.endsOn != null && right.endsOn < left.startsOn;
  return !leftEnded && !rightEnded;
}

/** A month stays on the series unless it was removed or the series has already ended. */
export function savingsMonthIsOpen(
  plan: Pick<SavingsPlanTemplate, "startsOn" | "endsOn" | "omittedMonths">,
  yearMonth: string,
): boolean {
  if (yearMonth < plan.startsOn) return false;
  if (plan.endsOn && yearMonth > plan.endsOn) return false;
  return !plan.omittedMonths?.includes(yearMonth);
}

/**
 * Amount due on each scheduled day in the month.
 * A month amount and a date range are the amount for each usual day, the same
 * way the standing amount is. A date range wins on the days it covers. A range
 * with no scheduled day keeps its amount on the first date.
 */
export function savingsOccurrenceAmounts(
  plan: Pick<
    SavingsPlanTemplate,
    | "amount"
    | "frequency"
    | "weekday"
    | "startsOn"
    | "endsOn"
    | "omittedMonths"
    | "monthAmounts"
    | "intervals"
  >,
  yearMonth: string,
): { date: string; amount: number }[] {
  if (!savingsMonthIsOpen(plan, yearMonth)) return [];
  const dates = datesForMonth(plan, yearMonth);
  const override = monthAmount(plan, yearMonth);
  const intervals = [...(plan.intervals ?? [])].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  const amounts = dates.map((date) => {
    const interval = intervals.find((item) => date >= item.from && date <= item.to);
    const rate = interval ? interval.amount : override != null ? override : plan.amount;
    return { date, amount: round2(rate) };
  });

  for (const interval of intervals) {
    if (interval.from.slice(0, 7) !== yearMonth) continue;
    if (scheduledDatesIn(plan, interval).length > 0) continue;
    amounts.push({ date: interval.from, amount: round2(interval.amount) });
  }
  amounts.sort((a, b) => a.date.localeCompare(b.date));
  return amounts;
}

function usesCustomDates(plan: SavingsPlanTemplate, yearMonth: string): boolean {
  const { from, to } = monthBounds(yearMonth);
  return (plan.intervals ?? []).some((interval) => interval.from <= to && interval.to >= from);
}

function datesForMonth(
  plan: Pick<SavingsPlanTemplate, "frequency" | "weekday">,
  yearMonth: string,
): string[] {
  const occurrence = occurrencesFor(yearMonth, plan.frequency, plan.weekday, null);
  if (occurrence.dates.length > 0) return occurrence.dates;
  if (plan.frequency === "monthly") return [monthBounds(yearMonth).from];
  return [];
}

function scheduledDatesIn(
  plan: Pick<SavingsPlanTemplate, "frequency" | "weekday" | "startsOn">,
  interval: PlannedInterval,
): string[] {
  const fromMonth = interval.from.slice(0, 7);
  const toMonth = interval.to.slice(0, 7);
  const dates: string[] = [];
  let cursor = fromMonth < plan.startsOn ? plan.startsOn : fromMonth;
  let guard = 0;
  while (cursor <= toMonth) {
    if (guard++ > 600) throw new Error("A date range is too long");
    for (const date of datesForMonth(plan, cursor)) {
      if (date >= interval.from && date <= interval.to) dates.push(date);
    }
    cursor = shiftYearMonth(cursor, 1);
  }
  return dates;
}

function monthAmount(
  plan: Pick<SavingsPlanTemplate, "monthAmounts">,
  yearMonth: string,
): number | null {
  const match = plan.monthAmounts?.find((row) => row.yearMonth === yearMonth);
  return match ? match.amount : null;
}

function savedInMonth(
  plan: SavingsPlanTemplate,
  yearMonth: string,
  transfers: SavingsTransfer[],
  entries: SavingsAccountEntry[],
): number {
  let total = 0;
  for (const transfer of transfers) {
    if (transfer.date.slice(0, 7) !== yearMonth) continue;
    if (transfer.toAccountId === plan.toAccountId) {
      total += transfer.amount;
    } else if (transfer.fromAccountId === plan.toAccountId) {
      total -= transfer.amount;
    }
  }
  for (const entry of entries) {
    if (entry.accountId !== plan.toAccountId) continue;
    if (entry.date.slice(0, 7) !== yearMonth) continue;
    total += entry.amount;
  }
  return round2(total);
}

function sumTotals(rows: SavingsPlanMonthCalc[]): SavingsMonthTotals {
  let planned = 0;
  let saved = 0;
  let remaining = 0;
  for (const row of rows) {
    planned += row.planned;
    saved += row.saved;
    remaining += row.remaining;
  }
  return {
    planned: round2(planned),
    saved: round2(saved),
    remaining: round2(remaining),
  };
}
