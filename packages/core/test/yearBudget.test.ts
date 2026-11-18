import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBudgetMonth, type FixedExpenseTemplate } from "../dist/budget.js";
import { buildSalaryMonth, type SalaryTemplate } from "../dist/schedule.js";
import type { SavingsPlanTemplate } from "../dist/savings.js";
import { buildYearBudget, type YearBudgetInput } from "../dist/yearBudget.js";

function input(overrides: Partial<YearBudgetInput> = {}): YearBudgetInput {
  return {
    year: 2026,
    asOfDate: "2026-06-15",
    accounts: [
      { id: "td", name: "TD", type: "checking", openingBalance: 0 },
      { id: "save", name: "Epargne", type: "savings", openingBalance: 1000 },
      { id: "celi", name: "CELI", type: "placement", openingBalance: 5000 },
    ],
    transactions: [
      { accountId: "save", date: "2026-05-01", amount: 100, categoryKind: null, transfer: true },
      { accountId: "celi", date: "2026-06-01", amount: 250, categoryKind: null, transfer: true },
    ],
    salaries: [],
    expenses: [],
    savingsPlans: [savingsPlan(), placementPlan()],
    transfers: [
      { date: "2026-05-01", fromAccountId: "td", toAccountId: "save", amount: 100 },
      { date: "2026-06-01", fromAccountId: "td", toAccountId: "celi", amount: 250 },
    ],
    ...overrides,
  };
}

function savingsPlan(): SavingsPlanTemplate {
  return {
    id: "epargne",
    name: "Epargne",
    amount: 200,
    frequency: "monthly",
    weekday: null,
    fromAccountId: "td",
    toAccountId: "save",
    startsOn: "2026-01",
    carryIn: 0,
  };
}

function placementPlan(): SavingsPlanTemplate {
  return {
    id: "celi",
    name: "CELI",
    amount: 400,
    frequency: "monthly",
    weekday: null,
    fromAccountId: "td",
    toAccountId: "celi",
    startsOn: "2026-06",
    carryIn: 0,
    monthAmounts: [{ yearMonth: "2026-07", amount: 50 }],
  };
}

describe("buildYearBudget", () => {
  it("keeps finished months on record and projects the objectives after that", () => {
    const year = buildYearBudget(input());
    const may = year.months[4];
    const june = year.months[5];
    const july = year.months[6];
    const august = year.months[7];

    assert.equal(may?.recorded, true);
    assert.equal(may?.savings, 1100);
    assert.equal(may?.placements, 5000);

    assert.equal(june?.recorded, false);
    assert.equal(june?.plannedSavings, 200);
    assert.equal(june?.plannedPlacements, 400);
    // Epargne is 1,100 on record. Jan–Apr still owe 800, May owes 100 after the
    // 100 deposit, and June adds its own 200.
    assert.equal(june?.savings, 2200);
    // CELI is 5,250 on record, with 150 of June's 400 still to set aside.
    assert.equal(june?.placements, 5400);

    assert.equal(july?.plannedPlacements, 50);
    assert.equal(july?.savings, 2400);
    assert.equal(july?.placements, 5450);
    assert.equal(august?.plannedPlacements, 400);
    assert.equal(august?.placements, 5850);
    assert.equal(year.totals.decemberSavings, 2200 + 200 * 6);
    assert.equal(year.pots.find((pot) => pot.id === "save")?.december, year.totals.decemberSavings);
    assert.equal(year.pots.find((pot) => pot.id === "celi")?.january, 5000);
  });

  it("does not take money back out when a placement is already ahead", () => {
    const year = buildYearBudget(
      input({
        asOfDate: "2026-10-22",
        transactions: [
          { accountId: "celi", date: "2026-10-01", amount: 600, categoryKind: null, transfer: true },
        ],
        transfers: [{ date: "2026-10-01", fromAccountId: "td", toAccountId: "celi", amount: 600 }],
        savingsPlans: [
          {
            ...placementPlan(),
            amount: 100,
            startsOn: "2026-10",
            monthAmounts: [],
          },
        ],
      }),
    );
    const october = year.months[9];
    const november = year.months[10];
    assert.equal(october?.placements, 5600);
    assert.equal(november?.plannedPlacements, 100);
    assert.equal(november?.placements, 5700);
  });

  it("counts a deposit dated later this month before adding what is still to set aside", () => {
    const year = buildYearBudget(
      input({
        asOfDate: "2026-10-22",
        transactions: [
          { accountId: "save", date: "2026-10-29", amount: 275, categoryKind: null, transfer: true },
        ],
        transfers: [{ date: "2026-10-29", fromAccountId: "td", toAccountId: "save", amount: 275 }],
        savingsPlans: [
          {
            ...savingsPlan(),
            amount: 275,
            startsOn: "2026-10",
          },
        ],
      }),
    );
    assert.equal(year.months[9]?.savings, 1275);
  });

  it("carries the projection into a later year", () => {
    const year = buildYearBudget(
      input({
        year: 2027,
        asOfDate: "2026-10-22",
        transactions: [
          { accountId: "celi", date: "2026-10-01", amount: 600, categoryKind: null, transfer: true },
        ],
        transfers: [{ date: "2026-10-01", fromAccountId: "td", toAccountId: "celi", amount: 600 }],
        savingsPlans: [
          {
            ...placementPlan(),
            amount: 100,
            startsOn: "2026-10",
            monthAmounts: [],
          },
        ],
      }),
    );
    assert.equal(year.months.every((month) => !month.recorded), true);
    // 5,600 already in by the end of October, the October plan is met, then Nov, Dec, and Jan.
    assert.equal(year.months[0]?.placements, 5900);
    assert.equal(year.totals.decemberPlacements, 5900 + 100 * 11);
  });

  it("uses recorded balances for a year that is already over", () => {
    const year = buildYearBudget(
      input({
        year: 2025,
        asOfDate: "2026-10-22",
        transactions: [
          { accountId: "save", date: "2025-02-01", amount: 40, categoryKind: null, transfer: true },
        ],
        transfers: [],
        savingsPlans: [savingsPlan()],
      }),
    );
    assert.equal(year.months.every((month) => month.recorded), true);
    assert.equal(year.months[0]?.savings, 1000);
    assert.equal(year.months[1]?.savings, 1040);
    assert.equal(year.totals.decemberSavings, 1040);
    assert.equal(year.months[1]?.plannedSavings, 0);
  });

  it("ignores an objective whose destination is not a savings or placement account", () => {
    const year = buildYearBudget(
      input({
        savingsPlans: [
          {
            ...savingsPlan(),
            toAccountId: "td",
          },
        ],
      }),
    );
    assert.equal(year.months[5]?.plannedSavings, 0);
    assert.equal(year.months[5]?.savings, 1100);
  });

  it("totals the year's paychecks and bills", () => {
    const salary: SalaryTemplate = {
      id: "armando",
      name: "Paie Armando",
      amount: 3325,
      rates: [{ effectiveOn: "2027-01", amount: 2950 }],
      anchorDate: "2026-10-22",
      startsOn: "2026-10",
      categoryId: "salary",
      accountId: null,
    };
    const rent: FixedExpenseTemplate = {
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
    const year = buildYearBudget(
      input({
        salaries: [salary],
        expenses: [rent],
        savingsPlans: [],
      }),
    );
    const octoberPay = buildSalaryMonth("2026-10", [salary], []).reduce((sum, row) => sum + row.expected, 0);
    assert.equal(year.months[9]?.expectedIncome, octoberPay);
    assert.equal(year.months[9]?.plannedExpenses, buildBudgetMonth("2026-10", [rent], [], []).totals.planned);
    assert.equal(year.months[8]?.plannedExpenses, 0);
    const nextYear = buildYearBudget(
      input({
        year: 2027,
        salaries: [salary],
        expenses: [rent],
        savingsPlans: [],
      }),
    );
    const januaryPay = buildSalaryMonth("2027-01", [salary], []).reduce((sum, row) => sum + row.expected, 0);
    assert.equal(nextYear.months[0]?.expectedIncome, januaryPay);
    assert.ok(januaryPay < octoberPay);
  });
});
