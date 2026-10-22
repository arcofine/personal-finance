import type { AccountType, CategoryKind } from "./types.js";
import { buildBudgetMonth, shiftYearMonth, type ExpenseActivity, type FixedExpenseMonthAdjustment, type FixedExpenseTemplate } from "./budget.js";
import { buildSalaryMonth, type SalaryTemplate } from "./schedule.js";
import { monthBounds, round2 } from "./spend.js";
import type { WeekForecast } from "./week.js";

export interface OverviewAccount {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: number;
}

export interface OverviewTransaction {
  accountId: string;
  date: string;
  amount: number;
  categoryKind: CategoryKind | null;
  transfer: boolean;
}

export interface OverviewInput {
  /** Month the overview is standing in (YYYY-MM). */
  asOf: string;
  /** Months of history, including `asOf`. Defaults to 6. */
  historyMonths?: number;
  /** Months of forecast, including `asOf`. Defaults to 6. */
  forecastMonths?: number;
  accounts: OverviewAccount[];
  transactions: OverviewTransaction[];
  salaries: SalaryTemplate[];
  expenses: FixedExpenseTemplate[];
  adjustments?: FixedExpenseMonthAdjustment[];
  activity?: ExpenseActivity[];
}

export interface OverviewTotals {
  netWorth: number;
  checking: number;
  cash: number;
  savings: number;
  placements: number;
  credit: number;
}

export interface OverviewAccountSlice {
  id: string;
  name: string;
  balance: number;
}

export interface OverviewPoint {
  yearMonth: string;
  /** Recorded expense-category spending, as a positive amount. Null after `asOf`. */
  expenses: number | null;
  /** Recorded income-category receipts. Null after `asOf`. */
  income: number | null;
  /** Savings balance at month end. Null after `asOf`. */
  savings: number | null;
  /** Placement balance at month end. Null after `asOf`. */
  placements: number | null;
  /** Paychecks expected that month, using dated salary changes. */
  expectedIncome: number;
  /** Fixed bills planned that month. */
  plannedExpenses: number;
  /** Expected pay minus planned fixed bills. */
  predictedLeft: number;
}

export interface Overview {
  asOf: string;
  historyStart: string;
  forecastEnd: string;
  totals: OverviewTotals;
  savingsAccounts: OverviewAccountSlice[];
  placementAccounts: OverviewAccountSlice[];
  /** Oldest first, from `historyStart` through `forecastEnd`. */
  months: OverviewPoint[];
}

export interface OverviewReport extends Overview {
  week: WeekForecast;
}

const DEFAULT_SPAN = 6;

/**
 * Household picture: recorded spending, savings and placement balances,
 * and a forecast of paychecks minus fixed bills.
 * Transfers move balances and are not counted as expenses.
 * Months after `asOf` are not guessed for variable spending or for
 * savings and placement balances.
 */
export function buildOverview(input: OverviewInput): Overview {
  const asOf = input.asOf;
  const historyMonths = clampCount(input.historyMonths);
  const forecastMonths = clampCount(input.forecastMonths);
  const historyStart = shiftYearMonth(asOf, -(historyMonths - 1));
  const forecastEnd = shiftYearMonth(asOf, forecastMonths - 1);
  const months = enumerateMonths(historyStart, forecastEnd);

  const txsByAccount = new Map<string, OverviewTransaction[]>();
  const expensesByMonth = new Map<string, number>();
  const incomeByMonth = new Map<string, number>();

  for (const tx of input.transactions) {
    const list = txsByAccount.get(tx.accountId);
    if (list) list.push(tx);
    else txsByAccount.set(tx.accountId, [tx]);

    if (tx.transfer || !isYearMonth(tx.date.slice(0, 7))) continue;
    const month = tx.date.slice(0, 7);
    if (tx.categoryKind === "expense") {
      expensesByMonth.set(month, (expensesByMonth.get(month) ?? 0) + Math.abs(tx.amount));
    } else if (tx.categoryKind === "income") {
      incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + tx.amount);
    }
  }

  const balances = input.accounts.map((account) => ({
    account,
    balance: balanceThrough(account, txsByAccount.get(account.id) ?? [], "9999-12-31"),
  }));

  const totals = emptyTotals();
  const savingsAccounts: OverviewAccountSlice[] = [];
  const placementAccounts: OverviewAccountSlice[] = [];
  for (const row of balances) {
    addTotal(totals, row.account.type, row.balance);
    const slice = { id: row.account.id, name: row.account.name, balance: row.balance };
    if (row.account.type === "savings") savingsAccounts.push(slice);
    if (row.account.type === "placement") placementAccounts.push(slice);
  }
  totals.netWorth = round2(totals.netWorth);
  totals.checking = round2(totals.checking);
  totals.cash = round2(totals.cash);
  totals.savings = round2(totals.savings);
  totals.placements = round2(totals.placements);
  totals.credit = round2(totals.credit);
  savingsAccounts.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  placementAccounts.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));

  const adjustments = input.adjustments ?? [];
  const activity = input.activity ?? [];
  const points: OverviewPoint[] = months.map((yearMonth) => {
    const recorded = yearMonth <= asOf;
    const { to } = monthBounds(yearMonth);
    const expectedIncome = round2(
      buildSalaryMonth(yearMonth, input.salaries, []).reduce((sum, row) => sum + row.expected, 0),
    );
    const plannedExpenses = buildBudgetMonth(
      yearMonth,
      input.expenses,
      adjustments,
      activity,
    ).totals.planned;
    return {
      yearMonth,
      expenses: recorded ? round2(expensesByMonth.get(yearMonth) ?? 0) : null,
      income: recorded ? round2(incomeByMonth.get(yearMonth) ?? 0) : null,
      savings: recorded ? sumTypeAt(balances, "savings", txsByAccount, to) : null,
      placements: recorded ? sumTypeAt(balances, "placement", txsByAccount, to) : null,
      expectedIncome,
      plannedExpenses,
      predictedLeft: round2(expectedIncome - plannedExpenses),
    };
  });

  return {
    asOf,
    historyStart,
    forecastEnd,
    totals,
    savingsAccounts,
    placementAccounts,
    months: points,
  };
}

function sumTypeAt(
  balances: { account: OverviewAccount }[],
  type: AccountType,
  txsByAccount: Map<string, OverviewTransaction[]>,
  through: string,
): number {
  let sum = 0;
  for (const row of balances) {
    if (row.account.type !== type) continue;
    sum += balanceThrough(row.account, txsByAccount.get(row.account.id) ?? [], through);
  }
  return round2(sum);
}

function balanceThrough(
  account: OverviewAccount,
  txs: OverviewTransaction[],
  through: string,
): number {
  let sum = account.openingBalance;
  for (const tx of txs) {
    if (tx.date <= through) sum += tx.amount;
  }
  return round2(sum);
}

function addTotal(totals: OverviewTotals, type: AccountType, balance: number): void {
  totals.netWorth += balance;
  if (type === "checking") totals.checking += balance;
  else if (type === "cash") totals.cash += balance;
  else if (type === "savings") totals.savings += balance;
  else if (type === "placement") totals.placements += balance;
  else if (type === "credit") totals.credit += balance;
}

function emptyTotals(): OverviewTotals {
  return { netWorth: 0, checking: 0, cash: 0, savings: 0, placements: 0, credit: 0 };
}

function clampCount(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_SPAN;
  return Math.min(24, Math.max(1, Math.floor(value)));
}

function enumerateMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to) {
    months.push(cursor);
    cursor = shiftYearMonth(cursor, 1);
    if (++guard > 240) throw new Error("Overview range is too long");
  }
  return months;
}

function isYearMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}
