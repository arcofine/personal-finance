import { occurrencesFor, type PayFrequency, type SalaryMonthRow, type Weekday } from "./schedule.js";
import { round2 } from "./spend.js";

/** How a month's paid amount was chosen. */
export type SpentSource = "manual" | "category" | "none";

/**
 * A fixed expense the household pays every month (rent, insurance, phone).
 * The monthly amount repeats. Leftover balance carries from month to month.
 */
export interface FixedExpense {
  id: string;
  householdId: string;
  name: string;
  /**
   * Amount of one occurrence. Monthly bills apply it once.
   * Weekly and bi-weekly bills multiply it by the dates in the month.
   */
  monthlyAmount: number;
  frequency: PayFrequency;
  /** Required when frequency is weekly. */
  weekday: Weekday | null;
  /** First due date (YYYY-MM-DD). Required when frequency is biweekly. */
  anchorDate: string | null;
  /** Day of the month a monthly bill is due, from 1 to 31. */
  dueDay: number | null;
  /** Spending in this category (and its subcategories) counts as paid. */
  categoryId: string | null;
  /** Account the bill is paid from. Empty counts every account. */
  accountId: string | null;
  /** First month the expense appears (YYYY-MM). */
  startsOn: string;
  /** Last month the expense appears (YYYY-MM). Null means it keeps repeating. */
  endsOn: string | null;
  /** Balance already on the envelope before `startsOn`. */
  carryIn: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateFixedExpenseInput {
  name: string;
  monthlyAmount: number;
  frequency?: PayFrequency;
  weekday?: Weekday | null;
  anchorDate?: string | null;
  dueDay?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  startsOn: string;
  carryIn?: number;
}

export interface UpdateFixedExpenseInput {
  name?: string;
  monthlyAmount?: number;
  frequency?: PayFrequency;
  weekday?: Weekday | null;
  anchorDate?: string | null;
  dueDay?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  carryIn?: number;
  startsOn?: string;
}

/** Which part of a repeating expense to remove. */
export type FixedExpenseRemoval = "month" | "future" | "all";

/** Per-month replacements for the standing plan or for category spending. */
export interface FixedExpenseMonthPatch {
  /** `null` clears the override and uses the monthly amount again. */
  plannedAmount?: number | null;
  /** `null` clears a hand-entered payment and uses category spending again. */
  paidAmount?: number | null;
}

export interface FixedExpenseTemplate {
  id: string;
  name: string;
  monthlyAmount: number;
  frequency: PayFrequency;
  weekday: Weekday | null;
  anchorDate: string | null;
  /** Day of the month a monthly bill is due. Empty for weekly and bi-weekly bills. */
  dueDay?: number | null;
  categoryId: string | null;
  accountId: string | null;
  startsOn: string;
  /** Last month the expense appears. Empty means it keeps repeating. */
  endsOn?: string | null;
  /** Months removed from the series. The envelope balance still passes through them. */
  omittedMonths?: string[];
  carryIn: number;
}

export interface FixedExpenseMonthAdjustment {
  fixedExpenseId: string;
  yearMonth: string;
  plannedAmount: number | null;
  paidAmount: number | null;
}

/** Signed category activity already rolled up for one fixed expense. */
export interface ExpenseActivity {
  fixedExpenseId: string;
  yearMonth: string;
  /** Signed sum. Negative means money left the household. */
  total: number;
}

export interface FixedExpenseMonthCalc {
  id: string;
  name: string;
  categoryId: string | null;
  accountId: string | null;
  monthlyAmount: number;
  frequency: PayFrequency;
  weekday: Weekday | null;
  anchorDate: string | null;
  dueDay: number | null;
  occurrences: number;
  dates: string[];
  startsOn: string;
  carryIn: number;
  broughtForward: number;
  planned: number;
  plannedOverridden: boolean;
  spent: number;
  spentSource: SpentSource;
  /** broughtForward + planned − spent. This becomes next month's brought forward. */
  left: number;
}

export interface BudgetMonthRow extends FixedExpenseMonthCalc {
  categoryName: string | null;
  accountName: string | null;
}

export interface BudgetTotals {
  broughtForward: number;
  planned: number;
  spent: number;
  left: number;
}

export interface BudgetMonth {
  yearMonth: string;
  previousMonth: string;
  nextMonth: string;
  income: SalaryMonthRow[];
  incomeTotal: number;
  rows: BudgetMonthRow[];
  totals: BudgetTotals;
}

export function assertYearMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const yearText = match?.[1];
  const monthText = match?.[2];
  if (!yearText || !monthText) throw new Error("Month must be YYYY-MM");
  const month = Number(monthText);
  if (month < 1 || month > 12) throw new Error("Month must be YYYY-MM");
  return value;
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(assertYearMonth(yearMonth));
  const yearText = match?.[1];
  const monthText = match?.[2];
  if (!yearText || !monthText) throw new Error("Month must be YYYY-MM");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Project each fixed expense through `yearMonth`.
 *
 * Balance for a month is the previous month's leftover, plus the plan, minus
 * what was paid. That leftover is the next month's brought-forward balance.
 * Paying less than the plan leaves money in the envelope. Paying more carries
 * a negative balance forward.
 */
export function buildBudgetMonth(
  yearMonth: string,
  expenses: FixedExpenseTemplate[],
  adjustments: FixedExpenseMonthAdjustment[],
  activity: ExpenseActivity[],
): { rows: FixedExpenseMonthCalc[]; totals: BudgetTotals } {
  assertYearMonth(yearMonth);

  const adjustmentByKey = new Map<string, FixedExpenseMonthAdjustment>();
  for (const adjustment of adjustments) {
    adjustmentByKey.set(`${adjustment.fixedExpenseId}|${adjustment.yearMonth}`, adjustment);
  }

  const activityByKey = new Map<string, number>();
  for (const row of activity) {
    activityByKey.set(`${row.fixedExpenseId}|${row.yearMonth}`, row.total);
  }

  const rows: FixedExpenseMonthCalc[] = [];
  for (const expense of expenses) {
    if (!monthIsOpen(expense, yearMonth)) continue;
    rows.push(projectExpense(expense, yearMonth, adjustmentByKey, activityByKey));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));

  return { rows, totals: sumTotals(rows) };
}

function projectExpense(
  expense: FixedExpenseTemplate,
  yearMonth: string,
  adjustmentByKey: Map<string, FixedExpenseMonthAdjustment>,
  activityByKey: Map<string, number>,
): FixedExpenseMonthCalc {
  assertYearMonth(expense.startsOn);

  let brought = round2(expense.carryIn);
  let cursor = expense.startsOn;
  let guard = 0;
  while (cursor < yearMonth) {
    if (guard++ > 600) {
      throw new Error("Budget history is too long to roll forward");
    }
    if (monthIsOpen(expense, cursor)) {
      brought = resolveMonth(expense, cursor, brought, adjustmentByKey, activityByKey).left;
    }
    cursor = shiftYearMonth(cursor, 1);
  }

  const current = resolveMonth(expense, yearMonth, brought, adjustmentByKey, activityByKey);
  return {
    id: expense.id,
    name: expense.name,
    categoryId: expense.categoryId,
    accountId: expense.accountId,
    monthlyAmount: round2(expense.monthlyAmount),
    frequency: expense.frequency,
    weekday: expense.weekday,
    anchorDate: expense.anchorDate,
    dueDay: expense.dueDay ?? null,
    startsOn: expense.startsOn,
    carryIn: round2(expense.carryIn),
    ...current,
  };
}

function resolveMonth(
  expense: FixedExpenseTemplate,
  yearMonth: string,
  broughtForward: number,
  adjustmentByKey: Map<string, FixedExpenseMonthAdjustment>,
  activityByKey: Map<string, number>,
): Pick<
  FixedExpenseMonthCalc,
  | "broughtForward"
  | "planned"
  | "plannedOverridden"
  | "occurrences"
  | "dates"
  | "spent"
  | "spentSource"
  | "left"
> {
  const adjustment = adjustmentByKey.get(`${expense.id}|${yearMonth}`);
  const occurrence = occurrencesFor(
    yearMonth,
    expense.frequency,
    expense.weekday,
    expense.anchorDate,
    expense.dueDay ?? null,
  );
  const plannedOverride = adjustment?.plannedAmount;
  let planned = round2(expense.monthlyAmount * occurrence.count);
  let plannedOverridden = false;
  if (plannedOverride != null) {
    planned = round2(plannedOverride);
    plannedOverridden = true;
  }

  const paidOverride = adjustment?.paidAmount;
  let spent: number;
  let spentSource: SpentSource;
  if (paidOverride != null) {
    spent = round2(paidOverride);
    spentSource = "manual";
  } else if (expense.categoryId) {
    const total = activityByKey.get(`${expense.id}|${yearMonth}`) ?? 0;
    spent = round2(-total);
    spentSource = "category";
  } else {
    spent = 0;
    spentSource = "none";
  }

  const forward = round2(broughtForward);
  return {
    broughtForward: forward,
    planned,
    plannedOverridden,
    occurrences: occurrence.count,
    dates: occurrence.dates,
    spent,
    spentSource,
    left: round2(forward + planned - spent),
  };
}

/** A month stays on the series unless it was removed or the series has already ended. */
export function monthIsOpen(expense: FixedExpenseTemplate, yearMonth: string): boolean {
  if (yearMonth < expense.startsOn) return false;
  if (expense.endsOn && yearMonth > expense.endsOn) return false;
  return !expense.omittedMonths?.includes(yearMonth);
}

function sumTotals(rows: FixedExpenseMonthCalc[]): BudgetTotals {
  let broughtForward = 0;
  let planned = 0;
  let spent = 0;
  let left = 0;
  for (const row of rows) {
    broughtForward += row.broughtForward;
    planned += row.planned;
    spent += row.spent;
    left += row.left;
  }
  return {
    broughtForward: round2(broughtForward),
    planned: round2(planned),
    spent: round2(spent),
    left: round2(left),
  };
}
