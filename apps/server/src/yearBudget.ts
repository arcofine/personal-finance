import {
  assertYear,
  buildYearBudget,
  type CategoryKind,
  type ExpenseActivity,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseTemplate,
  type OverviewTransaction,
  type SalaryTemplate,
  type YearBudget,
} from "@pf/core";
import { exportFixedExpenses } from "./budgetRepo.js";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";
import { listAccounts } from "./repo.js";
import { listSavingsPlanTemplates, loadAccountEntries, loadTransfers } from "./savingsRepo.js";

export function householdYear(db: Db, year: number, asOfDate: string): YearBudget {
  const householdId = getHouseholdId(db);
  const accounts = listAccounts(db).map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    openingBalance: account.openingBalance,
  }));

  const rows = db
    .prepare(
      `
      SELECT t.account_id, t.date, t.amount, t.transfer_group_id, c.kind
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
      WHERE t.household_id = ? AND t.deleted_at IS NULL
    `,
    )
    .all(householdId) as {
    account_id: string;
    date: string;
    amount: number;
    transfer_group_id: string | null;
    kind: string | null;
  }[];

  const transactions: OverviewTransaction[] = rows.map((row) => ({
    accountId: row.account_id,
    date: row.date,
    amount: row.amount,
    categoryKind: categoryKind(row.kind),
    transfer: row.transfer_group_id != null,
  }));

  const exported = exportFixedExpenses(db);
  const salaries: SalaryTemplate[] = exported.salaries.map((salary) => ({
    id: salary.id,
    name: salary.name,
    amount: salary.amount,
    rates: salary.rates,
    anchorDate: salary.anchorDate,
    startsOn: salary.startsOn,
    categoryId: salary.categoryId,
    accountId: salary.accountId,
  }));
  const omittedByExpense = new Map<string, string[]>();
  for (const month of exported.fixedExpenseMonths) {
    if (!month.omitted) continue;
    const months = omittedByExpense.get(month.fixedExpenseId) ?? [];
    months.push(month.yearMonth);
    omittedByExpense.set(month.fixedExpenseId, months);
  }
  const expenses: FixedExpenseTemplate[] = exported.fixedExpenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    monthlyAmount: expense.monthlyAmount,
    frequency: expense.frequency,
    weekday: expense.weekday,
    anchorDate: expense.anchorDate,
    dueDay: expense.dueDay,
    categoryId: expense.categoryId,
    accountId: expense.accountId,
    startsOn: expense.startsOn,
    endsOn: expense.endsOn,
    omittedMonths: omittedByExpense.get(expense.id) ?? [],
    carryIn: expense.carryIn,
  }));
  const adjustments: FixedExpenseMonthAdjustment[] = exported.fixedExpenseMonths
    .filter((month) => !month.omitted)
    .map((month) => ({
      fixedExpenseId: month.fixedExpenseId,
      yearMonth: month.yearMonth,
      plannedAmount: month.plannedAmount,
      paidAmount: month.paidAmount,
    }));
  const activity: ExpenseActivity[] = [];

  return buildYearBudget({
    year: assertYear(year),
    asOfDate,
    accounts,
    transactions,
    salaries,
    expenses,
    savingsPlans: listSavingsPlanTemplates(db),
    adjustments,
    activity,
    transfers: loadTransfers(db),
    entries: loadAccountEntries(db),
  });
}

function categoryKind(value: string | null): CategoryKind | null {
  if (value === "expense" || value === "income" || value === "transfer") return value;
  return null;
}
