import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthSummary, weeksInMonth } from "../dist/monthSummary.js";

describe("weeksInMonth", () => {
  it("clips Monday weeks to October 2026", () => {
    assert.deepEqual(weeksInMonth("2026-10"), [
      { from: "2026-10-01", to: "2026-10-04" },
      { from: "2026-10-05", to: "2026-10-11" },
      { from: "2026-10-12", to: "2026-10-18" },
      { from: "2026-10-19", to: "2026-10-25" },
      { from: "2026-10-26", to: "2026-10-31" },
    ]);
  });
});

describe("buildMonthSummary", () => {
  it("carries the previous month forward and groups each week", () => {
    const summary = buildMonthSummary({
      yearMonth: "2026-10",
      accounts: [
        { id: "td", name: "TD", type: "checking", openingBalance: 100 },
        { id: "rbc", name: "RBC", type: "checking", openingBalance: 1000 },
      ],
      categories: [
        { id: "income", name: "Income", parentId: null, kind: "income" },
        { id: "salary", name: "Salary", parentId: "income", kind: "income" },
        { id: "housing", name: "Housing", parentId: null, kind: "expense" },
        { id: "rent", name: "Rent", parentId: "housing", kind: "expense" },
      ],
      movements: [
        { accountId: "td", date: "2026-09-30", amount: 50, categoryId: null, transfer: false },
        { accountId: "td", date: "2026-10-02", amount: -20, categoryId: "rent", transfer: false },
        { accountId: "rbc", date: "2026-10-08", amount: 1000, categoryId: "salary", transfer: false },
        { accountId: "rbc", date: "2026-10-08", amount: -200, categoryId: null, transfer: true },
      ],
      plans: [
        {
          categoryId: "salary",
          kind: "income",
          dates: [{ date: "2026-10-08", amount: 1000 }],
          unscheduled: 0,
        },
        {
          categoryId: "rent",
          kind: "expense",
          dates: [{ date: "2026-10-01", amount: 2120 }],
          unscheduled: 40,
        },
      ],
    });

    assert.deepEqual(
      summary.accounts.map((account) => [account.name, account.start, account.weekEnd[0]]),
      [
        ["RBC", 1000, 1000],
        ["TD", 150, 130],
      ],
    );
    assert.equal(summary.accounts[0]?.weekEnd[1], 1800);
    const housing = summary.expenses.find((group) => group.name === "Housing");
    assert.equal(housing?.planned[0], 2120);
    assert.equal(housing?.realized[0], 20);
    assert.equal(housing?.unscheduled, 40);
    assert.equal(housing?.plannedTotal, 2160);
    const income = summary.income.find((group) => group.name === "Income");
    assert.equal(income?.planned[1], 1000);
    assert.equal(income?.realized[1], 1000);
    assert.equal(summary.incomeTotals.realizedTotal, 1000);
  });
});
