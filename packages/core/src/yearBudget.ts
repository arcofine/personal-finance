import {
  buildBudgetMonth,
  shiftYearMonth,
  type ExpenseActivity,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseTemplate,
} from "./budget.js";
import type { OverviewAccount, OverviewTransaction } from "./overview.js";
import { buildSalaryMonth, type SalaryTemplate } from "./schedule.js";
import {
  buildSavingsMonth,
  type SavingsAccountEntry,
  type SavingsPlanTemplate,
  type SavingsTransfer,
} from "./savings.js";
import { monthBounds, round2 } from "./spend.js";

export interface YearBudgetInput {
  year: number;
  /** Calendar date the projection stands on (YYYY-MM-DD). */
  asOfDate: string;
  accounts: OverviewAccount[];
  transactions: OverviewTransaction[];
  salaries: SalaryTemplate[];
  expenses: FixedExpenseTemplate[];
  adjustments?: FixedExpenseMonthAdjustment[];
  activity?: ExpenseActivity[];
  savingsPlans?: SavingsPlanTemplate[];
  transfers?: SavingsTransfer[];
  entries?: SavingsAccountEntry[];
}

export interface YearBudgetMonth {
  yearMonth: string;
  /**
   * True when this month is already over, so the pot balances are what was
   * recorded. The current month and later months are a projection.
   */
  recorded: boolean;
  expectedIncome: number;
  plannedExpenses: number;
  plannedSavings: number;
  plannedPlacements: number;
  predictedLeft: number;
  /** Savings balance at month end. */
  savings: number;
  /** Placement balance at month end. */
  placements: number;
}

export interface YearBudgetTotals {
  expectedIncome: number;
  plannedExpenses: number;
  plannedSavings: number;
  plannedPlacements: number;
  predictedLeft: number;
  /** Savings balance at the end of December. */
  decemberSavings: number;
  /** Placement balance at the end of December. */
  decemberPlacements: number;
}

export interface YearPot {
  id: string;
  name: string;
  type: "savings" | "placement";
  january: number;
  december: number;
}

export interface YearBudget {
  year: number;
  asOfDate: string;
  asOfMonth: string;
  months: YearBudgetMonth[];
  totals: YearBudgetTotals;
  pots: YearPot[];
}

/**
 * One calendar year of the budget, plus where savings and placement
 * accounts land if each month's objective is met.
 *
 * Months already finished use the recorded balance. From the as-of month
 * on, the balance keeps what is already in the account, adds whatever is
 * still to set aside this month, then adds each later month's objective.
 * Being ahead of the plan does not take money back out.
 */
export function buildYearBudget(input: YearBudgetInput): YearBudget {
  const year = assertYear(input.year);
  const asOfDate = assertDate(input.asOfDate);
  const asOfMonth = asOfDate.slice(0, 7);
  const months = yearMonths(year);
  const plans = input.savingsPlans ?? [];
  const transfers = input.transfers ?? [];
  const entries = input.entries ?? [];
  const adjustments = input.adjustments ?? [];
  const activity = input.activity ?? [];

  const accountType = new Map(input.accounts.map((account) => [account.id, account.type]));
  const txsByAccount = new Map<string, OverviewTransaction[]>();
  for (const tx of input.transactions) {
    const list = txsByAccount.get(tx.accountId);
    if (list) list.push(tx);
    else txsByAccount.set(tx.accountId, [tx]);
  }

  const plannedByMonth = new Map<string, Map<string, number>>();
  const planFor = (yearMonth: string): Map<string, number> => {
    const cached = plannedByMonth.get(yearMonth);
    if (cached) return cached;
    const split = new Map<string, number>();
    for (const row of buildSavingsMonth(yearMonth, plans, []).rows) {
      const type = accountType.get(row.toAccountId);
      if (type !== "savings" && type !== "placement") continue;
      split.set(row.toAccountId, round2((split.get(row.toAccountId) ?? 0) + row.planned));
    }
    plannedByMonth.set(yearMonth, split);
    return split;
  };

  const stillToSave = new Map<string, number>();
  for (const row of buildSavingsMonth(asOfMonth, plans, transfers, entries).rows) {
    const type = accountType.get(row.toAccountId);
    if (type !== "savings" && type !== "placement") continue;
    stillToSave.set(row.toAccountId, round2((stillToSave.get(row.toAccountId) ?? 0) + row.remaining));
  }

  const pots = input.accounts
    .filter((account) => account.type === "savings" || account.type === "placement")
    .sort((a, b) => a.name.localeCompare(b.name, "en-CA"));

  const balanceAt = (account: OverviewAccount, through: string): number => {
    let sum = account.openingBalance;
    for (const tx of txsByAccount.get(account.id) ?? []) {
      if (tx.date <= through) sum += tx.amount;
    }
    return round2(sum);
  };

  const projectedAt = new Map<string, Map<string, number>>();
  const balancesFor = (yearMonth: string): Map<string, number> => {
    const cached = projectedAt.get(yearMonth);
    if (cached) return cached;
    const balances = new Map<string, number>();
    for (const account of pots) {
      if (yearMonth < asOfMonth) {
        balances.set(account.id, balanceAt(account, monthBounds(yearMonth).to));
        continue;
      }
      let value = round2(
        balanceAt(account, monthBounds(asOfMonth).to) + Math.max(0, stillToSave.get(account.id) ?? 0),
      );
      let cursor = shiftYearMonth(asOfMonth, 1);
      let guard = 0;
      while (cursor <= yearMonth) {
        if (guard++ > 2400) throw new Error("Year projection is too long");
        value = round2(value + (planFor(cursor).get(account.id) ?? 0));
        cursor = shiftYearMonth(cursor, 1);
      }
      balances.set(account.id, value);
    }
    projectedAt.set(yearMonth, balances);
    return balances;
  };

  const points: YearBudgetMonth[] = months.map((yearMonth) => {
    const expectedIncome = round2(
      buildSalaryMonth(yearMonth, input.salaries, []).reduce((sum, row) => sum + row.expected, 0),
    );
    const plannedExpenses = buildBudgetMonth(yearMonth, input.expenses, adjustments, activity).totals.planned;
    const planned = planFor(yearMonth);
    let plannedSavings = 0;
    let plannedPlacements = 0;
    for (const [accountId, amount] of planned) {
      if (accountType.get(accountId) === "placement") plannedPlacements += amount;
      else plannedSavings += amount;
    }
    plannedSavings = round2(plannedSavings);
    plannedPlacements = round2(plannedPlacements);
    const balances = balancesFor(yearMonth);
    let savings = 0;
    let placements = 0;
    for (const account of pots) {
      const amount = balances.get(account.id) ?? 0;
      if (account.type === "placement") placements += amount;
      else savings += amount;
    }
    return {
      yearMonth,
      recorded: yearMonth < asOfMonth,
      expectedIncome,
      plannedExpenses,
      plannedSavings,
      plannedPlacements,
      predictedLeft: round2(expectedIncome - plannedExpenses - plannedSavings - plannedPlacements),
      savings: round2(savings),
      placements: round2(placements),
    };
  });

  const december = points[11];
  const januaryMonth = months[0];
  const decemberMonth = months[11];
  if (!december || !januaryMonth || !decemberMonth) throw new Error("A year has twelve months");
  const januaryBalances = balancesFor(januaryMonth);
  const decemberBalances = balancesFor(decemberMonth);

  return {
    year,
    asOfDate,
    asOfMonth,
    months: points,
    totals: {
      expectedIncome: round2(points.reduce((sum, month) => sum + month.expectedIncome, 0)),
      plannedExpenses: round2(points.reduce((sum, month) => sum + month.plannedExpenses, 0)),
      plannedSavings: round2(points.reduce((sum, month) => sum + month.plannedSavings, 0)),
      plannedPlacements: round2(points.reduce((sum, month) => sum + month.plannedPlacements, 0)),
      predictedLeft: round2(points.reduce((sum, month) => sum + month.predictedLeft, 0)),
      decemberSavings: december.savings,
      decemberPlacements: december.placements,
    },
    pots: pots.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type as "savings" | "placement",
      january: januaryBalances.get(account.id) ?? 0,
      december: decemberBalances.get(account.id) ?? 0,
    })),
  };
}

export function assertYear(value: number): number {
  if (!Number.isInteger(value) || value < 2000 || value > 2100) {
    throw new Error("Year must be from 2000 to 2100");
  }
  return value;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must be YYYY-MM-DD");
  const month = value.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Date must be YYYY-MM-DD");
  return value;
}

function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}
