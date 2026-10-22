import type { Weekday } from "./schedule.js";
import { occurrencesFor } from "./schedule.js";
import { assertYearMonth, shiftYearMonth } from "./budget.js";
import { round2 } from "./spend.js";

export type SavingsFrequency = "weekly" | "monthly";

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
  /** Unmet objective already owed before `startsOn`. Negative means ahead. */
  carryIn: number;
}

/** A real transfer between two accounts. Amount is positive. */
export interface SavingsTransfer {
  date: string;
  fromAccountId: string;
  toAccountId: string;
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
  /** Net moved into the destination from the source. A withdrawal reduces it. */
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
}

export interface UpdateSavingsPlanInput {
  name?: string;
  amount?: number;
  frequency?: SavingsFrequency;
  weekday?: Weekday | null;
  fromAccountId?: string;
  toAccountId?: string;
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

/**
 * Project each savings objective through `yearMonth`.
 * The plan repeats weekly or monthly. Transfers from the source into the
 * destination count as saved. Money leaving the destination sets the
 * objective back. What is still to save carries into the next month.
 */
export function buildSavingsMonth(
  yearMonth: string,
  plans: SavingsPlanTemplate[],
  transfers: SavingsTransfer[],
): SavingsMonth {
  assertYearMonth(yearMonth);
  const rows: SavingsPlanMonthCalc[] = [];
  for (const plan of plans) {
    if (plan.startsOn > yearMonth) continue;
    rows.push(projectPlan(plan, yearMonth, transfers));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  return { yearMonth, rows, totals: sumTotals(rows) };
}

function projectPlan(
  plan: SavingsPlanTemplate,
  yearMonth: string,
  transfers: SavingsTransfer[],
): SavingsPlanMonthCalc {
  assertYearMonth(plan.startsOn);
  let brought = round2(plan.carryIn);
  let cursor = plan.startsOn;
  let guard = 0;
  while (cursor < yearMonth) {
    if (guard++ > 600) throw new Error("Savings history is too long to roll forward");
    brought = round2(brought + plannedAmount(plan, cursor) - savedInMonth(plan, cursor, transfers));
    cursor = shiftYearMonth(cursor, 1);
  }
  const planned = plannedAmount(plan, yearMonth);
  const saved = savedInMonth(plan, yearMonth, transfers);
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
    saved,
    remaining: round2(brought + planned - saved),
  };
}

function plannedAmount(plan: SavingsPlanTemplate, yearMonth: string): number {
  const count = occurrencesFor(yearMonth, plan.frequency, plan.weekday, null).count;
  return round2(plan.amount * count);
}

function savedInMonth(
  plan: SavingsPlanTemplate,
  yearMonth: string,
  transfers: SavingsTransfer[],
): number {
  let total = 0;
  for (const transfer of transfers) {
    if (transfer.date.slice(0, 7) !== yearMonth) continue;
    if (
      transfer.toAccountId === plan.toAccountId &&
      transfer.fromAccountId === plan.fromAccountId
    ) {
      total += transfer.amount;
    } else if (transfer.fromAccountId === plan.toAccountId) {
      total -= transfer.amount;
    }
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
