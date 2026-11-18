import { addDays, assertISODate, weekdayOf } from "./schedule.js";
import { monthBounds, round2 } from "./spend.js";
import type { AccountType, CategoryKind } from "./types.js";

export interface SummaryAccount {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: number;
}

export interface SummaryMovement {
  accountId: string;
  date: string;
  amount: number;
  categoryId: string | null;
  transfer: boolean;
}

export interface SummaryCategory {
  id: string;
  name: string;
  parentId: string | null;
  kind: CategoryKind;
}

/** A budget item already placed on the dates it is due. Amounts are positive. */
export interface SummaryPlan {
  categoryId: string | null;
  kind: "income" | "expense";
  dates: { date: string; amount: number }[];
  /** Planned money that has no due date, so it cannot sit in a week. */
  unscheduled: number;
}

export interface SummaryWeek {
  from: string;
  to: string;
}

export interface SummaryGroup {
  id: string;
  name: string;
  planned: number[];
  realized: number[];
  plannedTotal: number;
  realizedTotal: number;
  unscheduled: number;
}

export interface SummaryAccountWeek {
  id: string;
  name: string;
  type: AccountType;
  /** Balance at the end of the previous month. */
  start: number;
  /** Balance after the realized activity of each week. */
  weekEnd: number[];
}

export interface SummaryTotals {
  planned: number[];
  realized: number[];
  plannedTotal: number;
  realizedTotal: number;
  unscheduled: number;
}

export interface MonthSummary {
  weeks: SummaryWeek[];
  accounts: SummaryAccountWeek[];
  income: SummaryGroup[];
  expenses: SummaryGroup[];
  incomeTotals: SummaryTotals;
  expenseTotals: SummaryTotals;
}

/**
 * Opening balances are everything dated before the month.
 * Weeks run Monday to Sunday and stop at the month edges.
 * Planned figures follow paycheck and bill dates. Realized figures follow
 * the register, with transfers left out of income and expenses.
 */
export function buildMonthSummary(input: {
  yearMonth: string;
  accounts: SummaryAccount[];
  movements: SummaryMovement[];
  categories: SummaryCategory[];
  plans: SummaryPlan[];
}): MonthSummary {
  const bounds = monthBounds(input.yearMonth);
  const weeks = weeksInMonth(input.yearMonth);
  const categories = new Map(input.categories.map((category) => [category.id, category]));

  const accounts = input.accounts
    .map((account) => {
      const mine = input.movements.filter((movement) => movement.accountId === account.id);
      let balance = account.openingBalance;
      for (const movement of mine) {
        if (movement.date < bounds.from) balance += movement.amount;
      }
      const start = round2(balance);
      const weekEnd = weeks.map((week) => {
        for (const movement of mine) {
          if (movement.date >= week.from && movement.date <= week.to) balance += movement.amount;
        }
        return round2(balance);
      });
      return { id: account.id, name: account.name, type: account.type, start, weekEnd };
    })
    .sort((a, b) => accountRank(a.type) - accountRank(b.type) || a.name.localeCompare(b.name, "en-CA"));

  const income = new Map<string, GroupBuild>();
  const expenses = new Map<string, GroupBuild>();
  const weekCount = weeks.length;

  for (const plan of input.plans) {
    const target = plan.kind === "income" ? income : expenses;
    const group = categoryGroup(plan.categoryId, plan.kind, categories);
    const row = ensureGroup(target, group, weekCount);
    row.unscheduled += plan.unscheduled;
    for (const dated of plan.dates) {
      const index = weekIndex(weeks, dated.date);
      if (index < 0) continue;
      row.planned[index] = (row.planned[index] ?? 0) + dated.amount;
    }
  }

  for (const movement of input.movements) {
    if (movement.transfer || movement.date < bounds.from || movement.date > bounds.to) continue;
    const category = movement.categoryId ? categories.get(movement.categoryId) : undefined;
    if (category?.kind === "transfer") continue;
    const kind = movementKind(movement, category?.kind);
    if (!kind) continue;
    const target = kind === "income" ? income : expenses;
    const group = categoryGroup(movement.categoryId, kind, categories);
    const row = ensureGroup(target, group, weekCount);
    const amount = kind === "income" ? movement.amount : -movement.amount;
    const index = weekIndex(weeks, movement.date);
    if (index < 0) continue;
    row.realized[index] = (row.realized[index] ?? 0) + amount;
  }

  const incomeRows = finishGroups(income);
  const expenseRows = finishGroups(expenses);
  return {
    weeks,
    accounts,
    income: incomeRows,
    expenses: expenseRows,
    incomeTotals: totalsOf(incomeRows, weekCount),
    expenseTotals: totalsOf(expenseRows, weekCount),
  };
}

/** Monday-first weeks clipped to the calendar month. */
export function weeksInMonth(yearMonth: string): SummaryWeek[] {
  const bounds = monthBounds(yearMonth);
  let cursor = bounds.from;
  while (weekdayOf(cursor) !== "monday") cursor = addDays(cursor, -1);

  const weeks: SummaryWeek[] = [];
  while (cursor <= bounds.to) {
    const end = addDays(cursor, 6);
    weeks.push({
      from: cursor < bounds.from ? bounds.from : cursor,
      to: end > bounds.to ? bounds.to : end,
    });
    cursor = addDays(end, 1);
  }
  return weeks;
}

interface GroupBuild {
  id: string;
  name: string;
  planned: number[];
  realized: number[];
  unscheduled: number;
}

function categoryGroup(
  categoryId: string | null,
  kind: "income" | "expense",
  categories: Map<string, SummaryCategory>,
): { id: string; name: string } {
  const category = categoryId ? categories.get(categoryId) : undefined;
  if (!category) return { id: `uncategorized-${kind}`, name: "Uncategorized" };
  const parent = category.parentId ? categories.get(category.parentId) : undefined;
  const group = parent ?? category;
  return { id: group.id, name: group.name };
}

function movementKind(
  movement: SummaryMovement,
  kind: CategoryKind | undefined,
): "income" | "expense" | null {
  if (kind === "income") return "income";
  if (kind === "expense") return "expense";
  if (kind) return null;
  if (movement.amount > 0) return "income";
  if (movement.amount < 0) return "expense";
  return null;
}

function ensureGroup(
  groups: Map<string, GroupBuild>,
  group: { id: string; name: string },
  weekCount: number,
): GroupBuild {
  const existing = groups.get(group.id);
  if (existing) return existing;
  const created = {
    id: group.id,
    name: group.name,
    planned: Array.from({ length: weekCount }, () => 0),
    realized: Array.from({ length: weekCount }, () => 0),
    unscheduled: 0,
  };
  groups.set(group.id, created);
  return created;
}

function finishGroups(groups: Map<string, GroupBuild>): SummaryGroup[] {
  return [...groups.values()]
    .map((group) => {
      const planned = group.planned.map((amount) => round2(amount));
      const realized = group.realized.map((amount) => round2(amount));
      const unscheduled = round2(group.unscheduled);
      return {
        id: group.id,
        name: group.name,
        planned,
        realized,
        unscheduled,
        plannedTotal: round2(planned.reduce((sum, amount) => sum + amount, 0) + unscheduled),
        realizedTotal: round2(realized.reduce((sum, amount) => sum + amount, 0)),
      };
    })
    .filter(
      (group) =>
        group.plannedTotal !== 0 ||
        group.realizedTotal !== 0 ||
        group.planned.some((amount) => amount !== 0) ||
        group.realized.some((amount) => amount !== 0),
    )
    .sort((a, b) => {
      if (a.name === "Uncategorized") return 1;
      if (b.name === "Uncategorized") return -1;
      return a.name.localeCompare(b.name, "en-CA");
    });
}

function totalsOf(groups: SummaryGroup[], weekCount: number): SummaryTotals {
  const planned = Array.from({ length: weekCount }, () => 0);
  const realized = Array.from({ length: weekCount }, () => 0);
  let unscheduled = 0;
  for (const group of groups) {
    group.planned.forEach((amount, index) => {
      planned[index] = round2((planned[index] ?? 0) + amount);
    });
    group.realized.forEach((amount, index) => {
      realized[index] = round2((realized[index] ?? 0) + amount);
    });
    unscheduled = round2(unscheduled + group.unscheduled);
  }
  return {
    planned,
    realized,
    unscheduled,
    plannedTotal: round2(planned.reduce((sum, amount) => sum + amount, 0) + unscheduled),
    realizedTotal: round2(realized.reduce((sum, amount) => sum + amount, 0)),
  };
}

function weekIndex(weeks: SummaryWeek[], date: string): number {
  assertISODate(date);
  return weeks.findIndex((week) => date >= week.from && date <= week.to);
}

function accountRank(type: AccountType): number {
  if (type === "checking") return 0;
  if (type === "cash") return 1;
  if (type === "savings") return 2;
  if (type === "credit") return 3;
  return 4;
}
