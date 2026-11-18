import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOverview, type OverviewInput } from "../dist/overview.js";
import type { FixedExpenseTemplate } from "../dist/budget.js";
import type { SalaryTemplate } from "../dist/schedule.js";
import type { SavingsPlanTemplate } from "../dist/savings.js";

function salary(): SalaryTemplate {
  return {
    id: "armando",
    name: "Paie Armando",
    amount: 3325,
    rates: [{ effectiveOn: "2027-01", amount: 2950 }],
    anchorDate: "2026-10-22",
    startsOn: "2026-10",
    categoryId: "salary",
    accountId: null,
  };
}

function rent(): FixedExpenseTemplate {
  return {
    id: "rent",
    name: "Rent",
    monthlyAmount: 2120,
    frequency: "monthly",
    weekday: null,
    anchorDate: null,
    categoryId: "rent",
    accountId: null,
    startsOn: "2026-10",
    carryIn: 0,
  };
}

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    asOf: "2026-10",
    historyMonths: 3,
    forecastMonths: 4,
    accounts: [
      { id: "td", name: "TD", type: "checking", openingBalance: 100 },
      { id: "save", name: "Epargne", type: "savings", openingBalance: 855.46 },
      { id: "celi", name: "CELI", type: "placement", openingBalance: 0 },
    ],
    transactions: [
      {
        accountId: "td",
        date: "2026-10-01",
        amount: 3325,
        categoryKind: "income",
        transfer: false,
      },
      {
        accountId: "td",
        date: "2026-10-01",
        amount: -2120,
        categoryKind: "expense",
        transfer: false,
      },
      {
        accountId: "td",
        date: "2026-09-15",
        amount: -40,
        categoryKind: "expense",
        transfer: false,
      },
      {
        accountId: "td",
        date: "2026-10-20",
        amount: -200,
        categoryKind: null,
        transfer: true,
      },
      {
        accountId: "celi",
        date: "2026-10-20",
        amount: 200,
        categoryKind: null,
        transfer: true,
      },
    ],
    salaries: [salary()],
    expenses: [rent()],
    ...overrides,
  };
}

describe("buildOverview", () => {
  it("sums savings and placements, and keeps transfers out of expenses", () => {
    const overview = buildOverview(input());
    assert.equal(overview.totals.savings, 855.46);
    assert.equal(overview.totals.placements, 200);
    assert.equal(overview.totals.checking, 100 + 3325 - 2120 - 200 - 40);
    assert.equal(overview.totals.netWorth, overview.totals.checking + 855.46 + 200);

    const october = overview.months.find((month) => month.yearMonth === "2026-10");
    assert.equal(october?.expenses, 2120);
    assert.equal(october?.income, 3325);
    assert.equal(october?.placements, 200);
    assert.equal(october?.savings, 855.46);

    const september = overview.months.find((month) => month.yearMonth === "2026-09");
    assert.equal(september?.expenses, 40);
    assert.equal(september?.placements, 0);
  });

  it("forecasts paycheck changes and leaves future balances blank", () => {
    const overview = buildOverview(input());
    assert.equal(overview.historyStart, "2026-08");
    assert.equal(overview.forecastEnd, "2027-01");

    const october = overview.months.find((month) => month.yearMonth === "2026-10");
    assert.equal(october?.expectedIncome, 6650);
    assert.equal(october?.plannedExpenses, 2120);
    assert.equal(october?.plannedSavings, 0);
    assert.equal(october?.predictedLeft, 4530);

    const january = overview.months.find((month) => month.yearMonth === "2027-01");
    assert.equal(january?.expectedIncome, 5900);
    assert.equal(january?.plannedExpenses, 2120);
    assert.equal(january?.plannedSavings, 0);
    assert.equal(january?.predictedLeft, 3780);
    assert.equal(january?.expenses, null);
    assert.equal(january?.income, null);
    assert.equal(january?.savings, null);
    assert.equal(january?.placements, null);
  });

  it("uses a one-month plan override in the forecast", () => {
    const overview = buildOverview(
      input({
        adjustments: [
          {
            fixedExpenseId: "rent",
            yearMonth: "2026-11",
            plannedAmount: 1800,
            paidAmount: null,
          },
        ],
      }),
    );
    const november = overview.months.find((month) => month.yearMonth === "2026-11");
    const december = overview.months.find((month) => month.yearMonth === "2026-12");
    assert.equal(november?.plannedExpenses, 1800);
    assert.equal(december?.plannedExpenses, 2120);
  });

  it("subtracts savings and placement objectives from what is left", () => {
    const plan: SavingsPlanTemplate = {
      id: "celi",
      name: "CELI",
      amount: 100,
      frequency: "weekly",
      weekday: "friday",
      fromAccountId: "td",
      toAccountId: "celi",
      startsOn: "2026-10",
      carryIn: 0,
      monthAmounts: [{ yearMonth: "2026-11", amount: 80 }],
    };
    const overview = buildOverview(input({ savingsPlans: [plan] }));
    const october = overview.months.find((month) => month.yearMonth === "2026-10");
    const november = overview.months.find((month) => month.yearMonth === "2026-11");
    const december = overview.months.find((month) => month.yearMonth === "2026-12");
    assert.equal(october?.plannedSavings, 500);
    assert.equal(october?.predictedLeft, 4030);
    assert.equal(november?.plannedSavings, 320);
    assert.equal(november?.predictedLeft, (november?.expectedIncome ?? 0) - (november?.plannedExpenses ?? 0) - 320);
    assert.equal(december?.plannedSavings, 400);
    assert.equal(december?.savings, null);
  });
});
