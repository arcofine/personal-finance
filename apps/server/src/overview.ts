import {
  assertYearMonth,
  buildOverview,
  buildWeekForecast,
  buildWeekFunds,
  shiftYearMonth,
  type AccountType,
  type CategoryKind,
  type ExpenseActivity,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseTemplate,
  type OverviewReport,
  type OverviewTransaction,
  type SalaryTemplate,
  type WeekBill,
  type WeekFund,
  type WeekFundPlan,
  type WeekMovement,
} from "@pf/core";
import { budgetMonth, exportFixedExpenses } from "./budgetRepo.js";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";
import { listAccounts } from "./repo.js";
import { listSavingsPlanTemplates } from "./savingsRepo.js";

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
      SELECT t.account_id, t.date, t.amount, t.payee, t.category_id, t.transfer_group_id, c.kind
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
      WHERE t.household_id = ? AND t.deleted_at IS NULL
    `,
    )
    .all(householdId) as {
    account_id: string;
    date: string;
    amount: number;
    payee: string | null;
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
    savingsPlans: listSavingsPlanTemplates(db),
    adjustments,
    activity,
  });

  const movements: WeekMovement[] = rows.map((row) => ({
    accountId: row.account_id,
    date: row.date,
    amount: row.amount,
    categoryId: row.category_id,
    payee: row.payee,
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
    weeks: coverageWeeks(db, asOf, listed, rows),
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

function coverageWeeks(
  db: Db,
  asOf: string,
  accounts: { id: string; type: AccountType; openingBalance: number }[],
  rows: {
    account_id: string;
    date: string;
    amount: number;
    payee: string | null;
    category_id: string | null;
    transfer_group_id: string | null;
  }[],
): WeekFund[] {
  const months = [asOf, shiftYearMonth(asOf, 1)];
  const plans: WeekFundPlan[] = months.flatMap((yearMonth) => {
    const budget = budgetMonth(db, yearMonth);
    const income = budget.income.map((row) => ({
      name: row.name,
      kind: "income" as const,
      accountId: row.accountId,
      categoryId: row.categoryId,
      dates: row.dates.map((date, index) => ({ date, amount: row.payAmounts[index] ?? 0 })),
      recorded: row.received,
    }));
    const bills = budget.rows.map((row) => ({
      name: row.name,
      kind: "expense" as const,
      accountId: row.accountId,
      categoryId: row.categoryId,
      dates: splitTotal(row.planned, row.dates),
      recorded: row.spent,
    }));
    return [...income, ...bills];
  });
  const savings = listSavingsPlanTemplates(db);

  return buildWeekFunds({
    fromMonth: asOf,
    toMonth: months[1] ?? asOf,
    accounts: accounts.map((account) => ({
      id: account.id,
      type: account.type,
      openingBalance: account.openingBalance,
    })),
    movements: rows.map((row) => ({
      accountId: row.account_id,
      date: row.date,
      amount: row.amount,
      categoryId: row.category_id,
      payee: row.payee,
      transferGroupId: row.transfer_group_id,
    })),
    plans,
    savings: savings.map((plan) => ({
      toAccountId: plan.toAccountId,
      amount: plan.amount,
      frequency: plan.frequency,
      weekday: plan.weekday,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      omittedMonths: plan.omittedMonths,
      monthAmounts: plan.monthAmounts,
      intervals: plan.intervals,
    })),
  });
}

function splitTotal(total: number, dates: string[]): { date: string; amount: number }[] {
  if (dates.length === 0) return [];
  const each = Math.round((total / dates.length) * 100) / 100;
  return dates.map((date, index) => ({
    date,
    amount:
      index === dates.length - 1
        ? Math.round((total - each * (dates.length - 1)) * 100) / 100
        : each,
  }));
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function categoryKind(value: string | null): CategoryKind | null {
  if (value === "expense" || value === "income" || value === "transfer") return value;
  return null;
}
