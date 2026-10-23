import type { BudgetMonth } from "./budget.js";
import type { SavingsMonthRow } from "./savings.js";
import { round2 } from "./spend.js";
import type { Category, Transaction } from "./types.js";

export type PerformanceStatus = "ahead" | "on-track" | "behind" | "not-budgeted";

export interface PerformanceRow {
  id: string;
  name: string;
  budgeted: number;
  realized: number;
  /** Positive is favourable: under budget for expenses, above target for income/savings. */
  variance: number;
  percent: number | null;
  status: PerformanceStatus;
}

export interface BudgetPerformance {
  income: {
    budgeted: number;
    realized: number;
    variance: number;
    percent: number | null;
  };
  expenses: {
    budgeted: number;
    realized: number;
    variance: number;
    percent: number | null;
    rows: PerformanceRow[];
  };
  savings: {
    budgeted: number;
    realized: number;
    variance: number;
    percent: number | null;
    rows: PerformanceRow[];
  };
}

/** Compare one month's plan with activity already recorded in the ledger. */
export function buildBudgetPerformance(
  budget: BudgetMonth,
  transactions: Transaction[],
  categories: Category[],
  savingsRows: SavingsMonthRow[],
): BudgetPerformance {
  const categoryKind = new Map(categories.map((category) => [category.id, category.kind]));
  const incomeRealized = round2(
    transactions.reduce((total, transaction) => {
      if (transaction.transferGroupId || !transaction.categoryId) return total;
      return categoryKind.get(transaction.categoryId) === "income"
        ? total + transaction.amount
        : total;
    }, 0),
  );

  const expenseRows = budget.rows.map((row) =>
    performanceRow(row.id, row.name, row.planned, row.spent, "expense"),
  );
  const savingsPerformance = savingsRows.map((row) =>
    performanceRow(row.id, row.name, row.planned, row.saved, "target"),
  );

  return {
    income: comparison(budget.incomeTotal, incomeRealized, "target"),
    expenses: {
      ...comparison(budget.totals.planned, budget.totals.spent, "expense"),
      rows: expenseRows,
    },
    savings: {
      ...comparison(
        savingsRows.reduce((total, row) => total + row.planned, 0),
        savingsRows.reduce((total, row) => total + row.saved, 0),
        "target",
      ),
      rows: savingsPerformance,
    },
  };
}

function performanceRow(
  id: string,
  name: string,
  budgeted: number,
  realized: number,
  direction: "expense" | "target",
): PerformanceRow {
  const values = comparison(budgeted, realized, direction);
  return { id, name, ...values, status: statusFor(values.variance, budgeted) };
}

function comparison(
  budgetedInput: number,
  realizedInput: number,
  direction: "expense" | "target",
): { budgeted: number; realized: number; variance: number; percent: number | null } {
  const budgeted = round2(budgetedInput);
  const realized = round2(realizedInput);
  const variance = round2(
    direction === "expense" ? budgeted - realized : realized - budgeted,
  );
  return {
    budgeted,
    realized,
    variance,
    percent: budgeted === 0 ? null : round2((realized / budgeted) * 100),
  };
}

function statusFor(variance: number, budgeted: number): PerformanceStatus {
  if (budgeted === 0) return "not-budgeted";
  if (Math.abs(variance) < 0.005) return "on-track";
  return variance > 0 ? "ahead" : "behind";
}
