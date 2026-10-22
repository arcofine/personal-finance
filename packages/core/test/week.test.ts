import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeekForecast, type WeekBill, type WeekForecastInput } from "../dist/week.js";
import type { SalaryTemplate } from "../dist/schedule.js";

const TODAY = "2026-10-21";

function salary(overrides: Partial<SalaryTemplate> = {}): SalaryTemplate {
  return {
    id: "armando",
    name: "Paie Armando",
    amount: 3325,
    rates: [{ effectiveOn: "2027-01", amount: 2950 }],
    anchorDate: "2026-10-22",
    startsOn: "2026-10",
    categoryId: "salary",
    accountId: "td",
    ...overrides,
  };
}

function rent(overrides: Partial<WeekBill> = {}): WeekBill {
  return {
    id: "rent",
    name: "Rent",
    amount: 2120,
    frequency: "monthly",
    weekday: null,
    anchorDate: null,
    startsOn: "2026-10",
    categoryId: "rent",
    accountId: "rbc",
    dueDay: 1,
    ...overrides,
  };
}

function input(overrides: Partial<WeekForecastInput> = {}): WeekForecastInput {
  return {
    today: TODAY,
    accounts: [
      { id: "td", name: "TD", type: "checking", balance: 1000 },
      { id: "rbc", name: "RBC", type: "checking", balance: 2580 },
      { id: "card", name: "Card", type: "credit", balance: -400 },
    ],
    salaries: [salary()],
    bills: [],
    movements: [],
    ...overrides,
  };
}

describe("buildWeekForecast", () => {
  it("starts at today and keeps a paycheck already on the register", () => {
    const week = buildWeekForecast(
      input({
        movements: [
          {
            accountId: "td",
            date: "2026-10-22",
            amount: 3325,
            categoryId: "salary",
            transfer: false,
          },
        ],
      }),
    );
    assert.equal(week.from, "2026-10-21");
    assert.equal(week.to, "2026-10-27");
    assert.equal(week.items.length, 1);
    assert.equal(week.items[0]?.recorded, true);
    assert.equal(week.items[0]?.balanceAfter, null);
    const td = week.accounts.find((account) => account.accountId === "td");
    assert.equal(td?.projected, 1000);
    assert.equal(td?.alert, false);
    assert.equal(
      week.accounts.find((account) => account.accountId === "card")?.alert,
      false,
    );
  });

  it("alerts when a bill lands before the account can cover it", () => {
    const week = buildWeekForecast(
      input({
        accounts: [{ id: "td", name: "TD", type: "checking", balance: 100 }],
        salaries: [salary({ anchorDate: "2026-10-24", amount: 500, rates: [] })],
        bills: [
          rent({
            frequency: "weekly",
            dueDay: null,
            weekday: "thursday",
            accountId: "td",
            amount: 150,
          }),
        ],
      }),
    );
    const bill = week.items.find((item) => item.kind === "expense");
    const pay = week.items.find((item) => item.kind === "income");
    assert.equal(bill?.date, "2026-10-22");
    assert.equal(bill?.balanceAfter, -50);
    assert.equal(pay?.date, "2026-10-24");
    assert.equal(pay?.balanceAfter, 450);
    const td = week.accounts.find((account) => account.accountId === "td");
    assert.equal(td?.alert, true);
    assert.equal(td?.shortOn, "2026-10-22");
    assert.equal(td?.shortfall, 50);
    assert.equal(td?.projected, 450);
    assert.equal(td?.lowest, -50);
  });

  it("lets same-day pay cover the bill and uses the January paycheck amount", () => {
    const covered = buildWeekForecast(
      input({
        accounts: [{ id: "td", name: "TD", type: "checking", balance: 100 }],
        salaries: [salary({ anchorDate: "2026-10-22", amount: 200, rates: [] })],
        bills: [
          rent({
            frequency: "weekly",
            dueDay: null,
            weekday: "thursday",
            accountId: "td",
            amount: 150,
          }),
        ],
      }),
    );
    assert.equal(covered.accounts[0]?.alert, false);
    assert.equal(covered.accounts[0]?.projected, 150);

    const january = buildWeekForecast(
      input({
        today: "2027-01-14",
        salaries: [salary()],
      }),
    );
    assert.equal(january.items[0]?.date, "2027-01-14");
    assert.equal(january.items[0]?.amount, 2950);
    assert.equal(january.accounts.find((account) => account.accountId === "td")?.projected, 1000 + 2950);
  });

  it("places a monthly bill on its due day and skips days outside the week", () => {
    const inside = buildWeekForecast(
      input({
        today: "2026-11-01",
        salaries: [],
        bills: [rent()],
      }),
    );
    assert.equal(inside.items.length, 1);
    assert.equal(inside.items[0]?.date, "2026-11-01");
    assert.equal(inside.items[0]?.amount, 2120);
    assert.equal(inside.accounts.find((account) => account.accountId === "rbc")?.projected, 2580 - 2120);

    const outside = buildWeekForecast(input({ bills: [rent()], salaries: [] }));
    assert.equal(outside.items.length, 0);
  });
});
