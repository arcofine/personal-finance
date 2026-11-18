import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBudgetPerformance } from "../dist/performance.js";
import type { BudgetMonth } from "../dist/budget.js";
import type { Category, Transaction } from "../dist/types.js";

const budget = {
  yearMonth: "2026-10",
  previousMonth: "2026-09",
  nextMonth: "2026-11",
  income: [],
  incomeTotal: 5000,
  rows: [
    { id: "rent", name: "Rent", planned: 2000, spent: 2000 },
    { id: "phone", name: "Phone", planned: 100, spent: 125 },
  ],
  totals: { broughtForward: 0, planned: 2100, spent: 2125, left: -25 },
} as unknown as BudgetMonth;

const categories = [
  { id: "salary", kind: "income" },
  { id: "rent", kind: "expense" },
] as Category[];

const transactions = [
  { id: "pay", amount: 4800, categoryId: "salary", transferGroupId: null },
  { id: "transfer", amount: 100, categoryId: "salary", transferGroupId: "pair" },
  { id: "expense", amount: -2000, categoryId: "rent", transferGroupId: null },
] as Transaction[];

describe("buildBudgetPerformance", () => {
  it("compares budgeted and realized income, expenses, and savings", () => {
    const report = buildBudgetPerformance(budget, transactions, categories, [
      {
        id: "emergency",
        name: "Emergency fund",
        planned: 500,
        saved: 350,
      },
    ] as never);

    assert.deepEqual(report.income, {
      budgeted: 5000,
      realized: 4800,
      variance: -200,
      percent: 96,
    });
    assert.equal(report.expenses.variance, -25);
    assert.equal(report.expenses.percent, 101.19);
    assert.equal(report.expenses.rows[0]?.status, "on-track");
    assert.equal(report.expenses.rows[1]?.status, "behind");
    assert.equal(report.savings.variance, -150);
    assert.equal(report.savings.percent, 70);
  });
});
