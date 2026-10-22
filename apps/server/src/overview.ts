import {
  assertYearMonth,
  buildOverview,
  buildWeekForecast,
  type CategoryKind,
  type ExpenseActivity,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseTemplate,
  type OverviewReport,
  type OverviewTransaction,
  type SalaryTemplate,
  type WeekBill,
  type WeekMovement,
} from "@pf/core";
import { exportFixedExpenses } from "./budgetRepo.js";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";
import { listAccounts } from "./repo.js";

export function householdOverview(db: Db, asOfInput: string): OverviewReport {
  const asOf = assertYearMonth(asOfInput);
  const householdId = getHouseholdId(db);
  const listed = listAccounts(db);
  const accounts = listed.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    openingBalance: account.openingBalance,
  }));

  const rows = db
    .prepare(
      `
      SELECT t.account_id, t.date, t.amount, t.category_id, t.transfer_group_id, c.kind
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
      WHERE t.household_id = ? AND t.deleted_at IS NULL
    `,
    )
    .all(householdId) as {
    account_id: string;
    date: string;
    amount: number;
    category_id: string | null;
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
  const overview = buildOverview({
    asOf,
    accounts,
    transactions,
    salaries,
    expenses,
    adjustments,
    activity,
  });

  const movements: WeekMovement[] = rows.map((row) => ({
    accountId: row.account_id,
    date: row.date,
    amount: row.amount,
    categoryId: row.category_id,
    transfer: row.transfer_group_id != null,
  }));
  const dueDayByCategory = latestDueDay(rows);
  const bills: WeekBill[] = expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    amount: expense.monthlyAmount,
    frequency: expense.frequency,
    weekday: expense.weekday,
    anchorDate: expense.anchorDate,
    startsOn: expense.startsOn,
    endsOn: expense.endsOn,
    omittedMonths: expense.omittedMonths,
    categoryId: expense.categoryId,
    accountId: expense.accountId,
    dueDay:
      expense.frequency === "monthly"
        ? (expense.dueDay ??
          (expense.categoryId ? (dueDayByCategory.get(expense.categoryId) ?? null) : null))
        : null,
  }));

  return {
    ...overview,
    week: buildWeekForecast({
      today: localToday(),
      accounts: listed.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        balance: account.balance,
      })),
      salaries,
      bills,
      movements,
      adjustments,
    }),
  };
}

function latestDueDay(
  rows: { category_id: string | null; date: string; amount: number; transfer_group_id: string | null }[],
): Map<string, number> {
  const due = new Map<string, number>();
  const ordered = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const row of ordered) {
    if (!row.category_id || row.transfer_group_id || row.amount >= 0 || due.has(row.category_id)) continue;
    const day = Number(row.date.slice(8, 10));
    if (day >= 1 && day <= 31) due.set(row.category_id, day);
  }
  return due;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function categoryKind(value: string | null): CategoryKind | null {
  if (value === "expense" || value === "income" || value === "transfer") return value;
  return null;
}
