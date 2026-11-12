import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeekFunds, type WeekFundAccount, type WeekFundMovement } from "../dist/weekFunds.js";

const checking: WeekFundAccount = { id: "rbc", type: "checking", openingBalance: 0 };
const celi: WeekFundAccount = { id: "celi", type: "placement", openingBalance: 0 };

function weekOf(funds: ReturnType<typeof buildWeekFunds>, from: string) {
  return funds.find((week) => week.from === from);
}

describe("buildWeekFunds", () => {
  it("does not charge a bill that is already on the register", () => {
    const movements: WeekFundMovement[] = [
      {
        accountId: "rbc",
        date: "2026-10-01",
        amount: -2120,
        categoryId: "rent",
        payee: "Rent Rivero",
        transferGroupId: null,
      },
    ];
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 3000 }],
      movements,
      plans: [
        {
          name: "Rent Rivero",
          kind: "expense",
          accountId: "rbc",
          categoryId: "rent",
          dates: [{ date: "2026-10-01", amount: 2120 }],
          recorded: 2120,
        },
      ],
      savings: [],
    });
    const week = weekOf(funds, "2026-10-01");
    assert.equal(week?.opening, 3000);
    assert.equal(week?.recordedOut, 2120);
    assert.equal(week?.billsDue, 0);
    assert.equal(week?.closing, 880);
    assert.equal(week?.covered, true);
    assert.deepEqual(week?.inflows, []);
    assert.deepEqual(week?.outflows, [{ date: "2026-10-01", name: "Rent Rivero", amount: 2120 }]);
    assert.deepEqual(week?.bills, []);
  });

  it("shows a shortfall when the bill comes before the paycheck", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 500 }],
      movements: [],
      plans: [
        {
          name: "Rent",
          kind: "expense",
          accountId: "rbc",
          categoryId: "rent",
          dates: [{ date: "2026-10-05", amount: 800 }],
          recorded: 0,
        },
        {
          name: "Paie",
          kind: "income",
          accountId: "rbc",
          categoryId: "salary",
          dates: [{ date: "2026-10-08", amount: 1000 }],
          recorded: 0,
        },
      ],
      savings: [],
    });
    const early = weekOf(funds, "2026-10-01");
    const week = weekOf(funds, "2026-10-05");
    assert.equal(early?.closing, 500);
    assert.equal(week?.opening, 500);
    assert.equal(week?.billsDue, 800);
    assert.equal(week?.incomeDue, 1000);
    assert.equal(week?.shortfall, 300);
    assert.equal(week?.closing, 700);
    assert.equal(week?.covered, false);
    assert.deepEqual(week?.bills, [{ date: "2026-10-05", name: "Rent", amount: 800 }]);
  });

  it("treats a transfer already made as covering the savings objective", () => {
    const made: WeekFundMovement[] = [
      {
        accountId: "rbc",
        date: "2026-10-01",
        amount: -600,
        categoryId: null,
        payee: "Transfer → CELI",
        transferGroupId: "g1",
      },
      {
        accountId: "celi",
        date: "2026-10-01",
        amount: 600,
        categoryId: null,
        payee: "Transfer ← RBC",
        transferGroupId: "g1",
      },
    ];
    const plan = {
      toAccountId: "celi",
      amount: 600,
      frequency: "weekly" as const,
      weekday: "thursday" as const,
      startsOn: "2026-10",
    };
    const covered = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 1000 }, celi],
      movements: made,
      plans: [],
      savings: [plan],
    });
    assert.equal(weekOf(covered, "2026-10-01")?.savingsDue, 0);
    assert.equal(weekOf(covered, "2026-10-01")?.closing, 400);
    assert.deepEqual(weekOf(covered, "2026-10-01")?.outflows, [
      { date: "2026-10-01", name: "Transfer → CELI", amount: 600 },
    ]);

    const waiting = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 1000 }, celi],
      movements: [],
      plans: [],
      savings: [plan],
    });
    assert.equal(weekOf(waiting, "2026-10-01")?.savingsDue, 600);
    assert.equal(weekOf(waiting, "2026-10-01")?.closing, 400);
    assert.equal(weekOf(waiting, "2026-10-01")?.covered, true);
  });

  it("lets money already received the same day cover a bill", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 100 }],
      movements: [
        {
          accountId: "rbc",
          date: "2026-10-01",
          amount: 500,
          categoryId: "salary",
          payee: "Paie",
          transferGroupId: null,
        },
        {
          accountId: "rbc",
          date: "2026-10-01",
          amount: -400,
          categoryId: "rent",
          payee: "Rent",
          transferGroupId: null,
        },
      ],
      plans: [],
      savings: [],
    });
    const week = weekOf(funds, "2026-10-01");
    assert.equal(week?.shortfall, 0);
    assert.equal(week?.closing, 200);
    assert.equal(week?.covered, true);
  });

  it("carries a short week into the next one", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 100 }],
      movements: [],
      plans: [
        {
          name: "Fee",
          kind: "expense",
          accountId: "rbc",
          categoryId: "fee",
          dates: [
            { date: "2026-10-02", amount: 50 },
            { date: "2026-10-06", amount: 80 },
          ],
          recorded: 0,
        },
      ],
      savings: [],
    });
    assert.equal(weekOf(funds, "2026-10-01")?.closing, 50);
    assert.equal(weekOf(funds, "2026-10-05")?.opening, 50);
    assert.equal(weekOf(funds, "2026-10-05")?.closing, -30);
    assert.equal(weekOf(funds, "2026-10-05")?.shortfall, 30);
  });

  it("does not charge a bill again when it was paid from the other chequing account", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-11",
      toMonth: "2026-11",
      accounts: [
        { id: "rbc", type: "checking", openingBalance: 2650.65 },
        { id: "td", type: "checking", openingBalance: 0 },
      ],
      movements: [
        {
          accountId: "rbc",
          date: "2026-11-01",
          amount: -2120,
          categoryId: "rent",
          payee: "Rent Rivero",
          transferGroupId: null,
        },
      ],
      plans: [
        {
          name: "Rent Rivero",
          kind: "expense",
          accountId: "td",
          categoryId: "rent",
          dates: [{ date: "2026-11-01", amount: 2120 }],
          recorded: 0,
        },
      ],
      savings: [],
    });
    const sunday = weekOf(funds, "2026-11-01");
    const week = weekOf(funds, "2026-11-02");
    assert.equal(sunday?.billsDue, 0);
    assert.equal(sunday?.recordedOut, 2120);
    assert.equal(sunday?.closing, 530.65);
    assert.equal(week?.opening, 530.65);
  });

  it("still expects a bill when the other account paid a different name", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-11",
      toMonth: "2026-11",
      accounts: [
        { id: "rbc", type: "checking", openingBalance: 3000 },
        { id: "td", type: "checking", openingBalance: 0 },
      ],
      movements: [
        {
          accountId: "rbc",
          date: "2026-11-01",
          amount: -50,
          categoryId: "rent",
          payee: "Groceries",
          transferGroupId: null,
        },
      ],
      plans: [
        {
          name: "Rent Rivero",
          kind: "expense",
          accountId: "td",
          categoryId: "rent",
          dates: [{ date: "2026-11-01", amount: 2120 }],
          recorded: 0,
        },
      ],
      savings: [],
    });
    assert.equal(weekOf(funds, "2026-11-01")?.billsDue, 2120);
    assert.equal(weekOf(funds, "2026-11-02")?.opening, 3000 - 50 - 2120);
  });

  it("uses a date range amount on each usual day it covers", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 5000 }],
      movements: [],
      plans: [],
      savings: [
        {
          toAccountId: "celi",
          amount: 50,
          frequency: "weekly",
          weekday: "friday",
          startsOn: "2026-10",
          intervals: [{ from: "2026-10-16", to: "2026-10-23", amount: 30 }],
        },
      ],
    });
    assert.equal(weekOf(funds, "2026-10-05")?.savingsDue, 50);
    assert.equal(weekOf(funds, "2026-10-12")?.savingsDue, 30);
    assert.equal(weekOf(funds, "2026-10-19")?.savingsDue, 30);
  });

  it("lists each deposit, withdrawal, and the part of a bill still unpaid", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-10",
      toMonth: "2026-10",
      accounts: [{ ...checking, openingBalance: 1000 }],
      movements: [
        {
          accountId: "rbc",
          date: "2026-10-01",
          amount: 400,
          categoryId: "salary",
          payee: "Paie",
          transferGroupId: null,
        },
        {
          accountId: "rbc",
          date: "2026-10-02",
          amount: -25,
          categoryId: "food",
          payee: null,
          transferGroupId: null,
        },
        {
          accountId: "rbc",
          date: "2026-10-02",
          amount: -15,
          categoryId: "food",
          payee: "Cafe",
          transferGroupId: null,
        },
      ],
      plans: [
        {
          name: "Hydro",
          kind: "expense",
          accountId: "rbc",
          categoryId: "hydro",
          dates: [{ date: "2026-10-03", amount: 100 }],
          recorded: 40,
        },
      ],
      savings: [],
    });
    const week = weekOf(funds, "2026-10-01");
    assert.deepEqual(week?.inflows, [{ date: "2026-10-01", name: "Paie", amount: 400 }]);
    assert.deepEqual(week?.outflows, [
      { date: "2026-10-02", name: "—", amount: 25 },
      { date: "2026-10-02", name: "Cafe", amount: 15 },
    ]);
    assert.deepEqual(week?.bills, [{ date: "2026-10-03", name: "Hydro", amount: 60 }]);
    assert.equal(week?.recordedIn, 400);
    assert.equal(week?.recordedOut, 40);
    assert.equal(week?.billsDue, 60);
  });
});
