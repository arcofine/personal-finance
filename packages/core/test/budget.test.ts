import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeExpenseActivity,
  buildBudgetMonth,
  shiftYearMonth,
  type ExpenseActivity,
  type FixedExpenseMonthAdjustment,
  type FixedExpenseTemplate,
} from "../dist/budget.js";

function rent(overrides: Partial<FixedExpenseTemplate> = {}): FixedExpenseTemplate {
  return {
    id: "rent",
    name: "Rent",
    monthlyAmount: 1800,
    frequency: "monthly",
    weekday: null,
    anchorDate: null,
    categoryId: "cat-rent",
    accountId: null,
    startsOn: "2026-01",
    carryIn: 0,
    ...overrides,
  };
}

describe("shiftYearMonth", () => {
  it("crosses year boundaries", () => {
    assert.equal(shiftYearMonth("2026-12", 1), "2027-01");
    assert.equal(shiftYearMonth("2026-01", -1), "2025-12");
  });
});

describe("buildBudgetMonth", () => {
  it("shows under-spend in the month and carries nothing forward", () => {
    const january = buildBudgetMonth("2026-01", [rent()], [], []);
    assert.equal(january.rows[0]?.left, 1800);

    const activity: ExpenseActivity[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-02", total: -1700 },
    ];
    const february = buildBudgetMonth("2026-02", [rent()], [], activity);
    assert.equal(february.rows[0]?.broughtForward, 0);
    assert.equal(february.rows[0]?.planned, 1800);
    assert.equal(february.rows[0]?.spent, 1700);
    assert.equal(february.rows[0]?.left, 100);

    const march = buildBudgetMonth("2026-03", [rent()], [], activity);
    assert.equal(march.rows[0]?.broughtForward, 0);
    assert.equal(march.rows[0]?.left, 1800);
  });

  it("uses category spending when the payment matches the plan", () => {
    const activity: ExpenseActivity[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-01", total: -1800 },
    ];
    const january = buildBudgetMonth("2026-01", [rent()], [], activity);
    assert.equal(january.rows[0]?.spent, 1800);
    assert.equal(january.rows[0]?.spentSource, "category");
    assert.equal(january.rows[0]?.left, 0);
  });

  it("keeps an overspend in the month it happened", () => {
    const activity: ExpenseActivity[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-01", total: -1900 },
    ];
    const january = buildBudgetMonth("2026-01", [rent()], [], activity);
    assert.equal(january.rows[0]?.spent, 1900);
    assert.equal(january.rows[0]?.left, -100);

    const february = buildBudgetMonth("2026-02", [rent()], [], activity);
    assert.equal(february.rows[0]?.broughtForward, 0);
    assert.equal(february.rows[0]?.planned, 1800);
    assert.equal(february.rows[0]?.left, 1800);

    const paidOnPlan: ExpenseActivity[] = [
      ...activity,
      { fixedExpenseId: "rent", yearMonth: "2026-02", total: -1800 },
    ];
    const settled = buildBudgetMonth("2026-02", [rent()], [], paidOnPlan);
    assert.equal(settled.rows[0]?.broughtForward, 0);
    assert.equal(settled.rows[0]?.spent, 1800);
    assert.equal(settled.rows[0]?.left, 0);
  });

  it("lets a hand-entered payment replace category spending", () => {
    const adjustments: FixedExpenseMonthAdjustment[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-01", plannedAmount: null, paidAmount: 1700 },
    ];
    const activity: ExpenseActivity[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-01", total: -50 },
    ];
    const january = buildBudgetMonth("2026-01", [rent()], adjustments, activity);
    assert.equal(january.rows[0]?.spent, 1700);
    assert.equal(january.rows[0]?.spentSource, "manual");
    assert.equal(january.rows[0]?.left, 100);
  });

  it("applies a one-month plan override without changing other months", () => {
    const adjustments: FixedExpenseMonthAdjustment[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-02", plannedAmount: 50, paidAmount: 50 },
    ];
    const january = buildBudgetMonth("2026-01", [rent({ monthlyAmount: 100 })], adjustments, []);
    assert.equal(january.rows[0]?.planned, 100);
    assert.equal(january.rows[0]?.plannedOverridden, false);

    const february = buildBudgetMonth("2026-02", [rent({ monthlyAmount: 100 })], adjustments, []);
    assert.equal(february.rows[0]?.planned, 50);
    assert.equal(february.rows[0]?.plannedOverridden, true);
    assert.deepEqual(february.rows[0]?.plannedMonths, [{ yearMonth: "2026-02", amount: 50 }]);
    assert.deepEqual(january.rows[0]?.plannedMonths, [{ yearMonth: "2026-02", amount: 50 }]);
    assert.equal(january.rows[0]?.left, 100);
    assert.equal(february.rows[0]?.left, 0);

    const march = buildBudgetMonth("2026-03", [rent({ monthlyAmount: 100 })], adjustments, []);
    assert.equal(march.rows[0]?.planned, 100);
    assert.equal(march.rows[0]?.broughtForward, 0);
    assert.equal(march.rows[0]?.left, 100);
  });

  it("starts with carry-in and hides months before the expense begins", () => {
    const expense = rent({ startsOn: "2026-03", carryIn: 40, monthlyAmount: 100, categoryId: null });
    const before = buildBudgetMonth("2026-02", [expense], [], []);
    assert.equal(before.rows.length, 0);

    const march = buildBudgetMonth("2026-03", [expense], [], []);
    assert.equal(march.rows[0]?.broughtForward, 40);
    assert.equal(march.rows[0]?.spentSource, "none");
    assert.equal(march.rows[0]?.left, 100);

    const april = buildBudgetMonth("2026-04", [expense], [], []);
    assert.equal(april.rows[0]?.broughtForward, 0);
  });

  it("treats a category refund as money returned to the envelope", () => {
    const activity: ExpenseActivity[] = [
      { fixedExpenseId: "rent", yearMonth: "2026-01", total: 25 },
    ];
    const january = buildBudgetMonth("2026-01", [rent({ monthlyAmount: 100 })], [], activity);
    assert.equal(january.rows[0]?.spent, -25);
    assert.equal(january.rows[0]?.left, 125);
  });

  it("multiplies weekly and bi-weekly amounts by the dates in each month", () => {
    const weekly = rent({
      monthlyAmount: 100,
      frequency: "weekly",
      weekday: "friday",
      startsOn: "2026-10",
      categoryId: null,
    });
    const october = buildBudgetMonth("2026-10", [weekly], [], []);
    assert.equal(october.rows[0]?.occurrences, 5);
    assert.equal(october.rows[0]?.planned, 500);
    assert.equal(october.rows[0]?.left, 500);

    const november = buildBudgetMonth("2026-11", [weekly], [], []);
    assert.equal(november.rows[0]?.occurrences, 4);
    assert.equal(november.rows[0]?.broughtForward, 0);
    assert.equal(november.rows[0]?.planned, 400);
    assert.equal(november.rows[0]?.left, 400);

    const biweekly = rent({
      id: "hydro",
      name: "Hydro",
      monthlyAmount: 200,
      frequency: "biweekly",
      weekday: null,
      anchorDate: "2026-10-02",
      startsOn: "2026-10",
      categoryId: null,
    });
    const hydroOctober = buildBudgetMonth("2026-10", [biweekly], [], []);
    assert.deepEqual(hydroOctober.rows[0]?.dates, ["2026-10-02", "2026-10-16", "2026-10-30"]);
    assert.equal(hydroOctober.rows[0]?.planned, 600);
  });

  it("places a monthly bill on its due day", () => {
    const october = buildBudgetMonth("2026-10", [rent({ dueDay: 1 })], [], []);
    assert.deepEqual(october.rows[0]?.dates, ["2026-10-01"]);

    const february = buildBudgetMonth(
      "2026-02",
      [rent({ dueDay: 31, startsOn: "2026-01" })],
      [],
      [],
    );
    assert.deepEqual(february.rows[0]?.dates, ["2026-02-28"]);
  });

  it("sorts rows and totals them", () => {
    const expenses = [
      rent({ id: "rent", name: "Rent", monthlyAmount: 100, categoryId: null }),
      rent({ id: "phone", name: "Phone", monthlyAmount: 50, categoryId: null }),
    ];
    const january = buildBudgetMonth("2026-01", expenses, [], []);
    assert.deepEqual(
      january.rows.map((row) => row.name),
      ["Phone", "Rent"],
    );
    assert.deepEqual(january.totals, {
      broughtForward: 0,
      planned: 150,
      spent: 0,
      left: 150,
    });
  });

  it("drops one month and carries the envelope through it", () => {
    const expense = rent({ omittedMonths: ["2026-02"] });
    const january = buildBudgetMonth("2026-01", [expense], [], []);
    assert.equal(january.rows[0]?.left, 1800);

    const february = buildBudgetMonth("2026-02", [expense], [], []);
    assert.equal(february.rows.length, 0);

    const march = buildBudgetMonth("2026-03", [expense], [], []);
    assert.equal(march.rows[0]?.broughtForward, 0);
    assert.equal(march.rows[0]?.planned, 1800);
    assert.equal(march.rows[0]?.left, 1800);
  });

  it("hides months after the series ends", () => {
    const expense = rent({ endsOn: "2026-01" });
    assert.equal(buildBudgetMonth("2026-01", [expense], [], []).rows.length, 1);
    assert.equal(buildBudgetMonth("2026-02", [expense], [], []).rows.length, 0);
  });
});

describe("attributeExpenseActivity", () => {
  const categories = [
    { id: "housing", parentId: null },
    { id: "rent", parentId: "housing" },
    { id: "lifestyle", parentId: null },
  ];

  it("keeps one category's spending on the only bill that uses it", () => {
    const activity = attributeExpenseActivity(
      [
        { id: "rent-bill", name: "Rent Rivero", categoryId: "rent", accountId: "rbc" },
        { id: "loan", name: "Pret Etudiant", categoryId: "lifestyle", accountId: "rbc" },
      ],
      categories,
      [
        { categoryId: "rent", accountId: "rbc", yearMonth: "2026-10", payee: "Rivero", total: -2120 },
        { categoryId: "lifestyle", accountId: "rbc", yearMonth: "2026-10", payee: "Pret Etudiant", total: -186 },
      ],
    );
    assert.deepEqual(
      activity.map((row) => [row.fixedExpenseId, row.total]),
      [
        ["rent-bill", -2120],
        ["loan", -186],
      ],
    );
  });

  it("splits a shared category by the payment name and keeps the specific subcategory", () => {
    const activity = attributeExpenseActivity(
      [
        { id: "loan", name: "Pret Etudiant", categoryId: "lifestyle", accountId: "rbc" },
        { id: "other", name: "Other lifestyle", categoryId: "lifestyle", accountId: "rbc" },
        { id: "housing-bill", name: "Housing", categoryId: "housing", accountId: null },
        { id: "rent-bill", name: "Rent Rivero", categoryId: "rent", accountId: "rbc" },
      ],
      categories,
      [
        { categoryId: "lifestyle", accountId: "rbc", yearMonth: "2026-10", payee: "Pret Etudiant", total: -186 },
        { categoryId: "lifestyle", accountId: "rbc", yearMonth: "2026-10", payee: "Metro", total: -40 },
        { categoryId: "rent", accountId: "rbc", yearMonth: "2026-10", payee: "Rivero", total: -2120 },
      ],
    );
    const byId = new Map(activity.map((row) => [row.fixedExpenseId, row.total]));
    assert.equal(byId.get("loan"), -186);
    assert.equal(byId.get("other"), undefined);
    assert.equal(byId.get("rent-bill"), -2120);
    assert.equal(byId.get("housing-bill"), undefined);
  });
});
