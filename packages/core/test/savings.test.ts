import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSavingsMonth,
  savingsRangesOverlap,
  type SavingsAccountEntry,
  type SavingsPlanTemplate,
  type SavingsTransfer,
} from "../dist/savings.js";

function epargne(overrides: Partial<SavingsPlanTemplate> = {}): SavingsPlanTemplate {
  return {
    id: "epargne",
    name: "Epargne",
    amount: 50,
    frequency: "weekly",
    weekday: "friday",
    fromAccountId: "td",
    toAccountId: "save",
    startsOn: "2026-10",
    carryIn: 0,
    ...overrides,
  };
}

describe("buildSavingsMonth", () => {
  it("counts every deposit into the destination, including one from another account", () => {
    const transfers: SavingsTransfer[] = [
      { date: "2026-10-22", fromAccountId: "td", toAccountId: "save", amount: 200 },
      { date: "2026-10-15", fromAccountId: "rbc", toAccountId: "save", amount: 80 },
    ];
    const october = buildSavingsMonth("2026-10", [epargne()], transfers);
    const row = october.rows[0];
    assert.equal(row?.occurrences, 5);
    assert.equal(row?.planned, 250);
    assert.equal(row?.saved, 280);
    assert.equal(row?.remaining, -30);
    assert.equal(october.totals.remaining, -30);
  });

  it("counts a register deposit on the destination and ignores other accounts", () => {
    const transfers: SavingsTransfer[] = [
      { date: "2026-10-15", fromAccountId: "td", toAccountId: "save", amount: 200 },
    ];
    const entries: SavingsAccountEntry[] = [
      { accountId: "save", date: "2026-10-22", amount: 600 },
      { accountId: "save", date: "2026-10-28", amount: -45 },
      { accountId: "td", date: "2026-10-22", amount: 1000 },
      { accountId: "save", date: "2026-11-03", amount: 50 },
    ];
    const october = buildSavingsMonth("2026-10", [epargne()], transfers, entries);
    assert.equal(october.rows[0]?.saved, 755);

    const november = buildSavingsMonth("2026-11", [epargne()], transfers, entries);
    assert.equal(november.rows[0]?.saved, 50);
    assert.equal(november.rows[0]?.broughtForward, -505);
  });

  it("carries a shortfall forward and lets a withdrawal set the objective back", () => {
    const transfers: SavingsTransfer[] = [
      { date: "2026-10-22", fromAccountId: "td", toAccountId: "save", amount: 200 },
      { date: "2026-11-02", fromAccountId: "save", toAccountId: "td", amount: 40 },
    ];
    const november = buildSavingsMonth("2026-11", [epargne()], transfers);
    const row = november.rows[0];
    assert.equal(row?.broughtForward, 50);
    assert.equal(row?.occurrences, 4);
    assert.equal(row?.planned, 200);
    assert.equal(row?.saved, -40);
    assert.equal(row?.remaining, 290);
  });

  it("hides a monthly objective before it starts", () => {
    const october = buildSavingsMonth("2026-10", [
      epargne({ frequency: "monthly", weekday: null, amount: 400, startsOn: "2026-11" }),
    ], []);
    assert.equal(october.rows.length, 0);

    const november = buildSavingsMonth("2026-11", [
      epargne({ frequency: "monthly", weekday: null, amount: 400, startsOn: "2026-11" }),
    ], []);
    assert.equal(november.rows[0]?.planned, 400);
    assert.equal(november.rows[0]?.occurrences, 1);
  });

  it("replaces one month and leaves the following month on the usual amount", () => {
    const plan = epargne({ monthAmounts: [{ yearMonth: "2026-10", amount: 80 }] });
    const october = buildSavingsMonth("2026-10", [plan], []);
    assert.equal(october.rows[0]?.planned, 400);
    assert.equal(october.rows[0]?.plannedOverridden, true);
    assert.equal(october.rows[0]?.remaining, 400);

    const november = buildSavingsMonth("2026-11", [plan], []);
    assert.equal(november.rows[0]?.planned, 200);
    assert.equal(november.rows[0]?.plannedOverridden, false);
    assert.equal(november.rows[0]?.broughtForward, 400);
  });

  it("replaces only the dates inside a range and keeps the usual amount outside it", () => {
    const plan = epargne({
      intervals: [{ from: "2026-10-16", to: "2026-10-23", amount: 30 }],
    });
    const october = buildSavingsMonth("2026-10", [plan], []);
    assert.equal(october.rows[0]?.planned, 210);
    assert.equal(october.rows[0]?.customDates, true);
    assert.equal(october.rows[0]?.plannedOverridden, false);
    assert.deepEqual(october.rows[0]?.intervals, [
      { from: "2026-10-16", to: "2026-10-23", amount: 30 },
    ]);

    const november = buildSavingsMonth("2026-11", [plan], []);
    assert.equal(november.rows[0]?.planned, 200);
    assert.equal(november.rows[0]?.customDates, false);
    assert.equal(november.rows[0]?.broughtForward, 210);
  });

  it("keeps the amount on each usual day a range covers, including across months", () => {
    const plan = epargne({
      intervals: [{ from: "2026-10-23", to: "2026-11-06", amount: 40 }],
    });
    const october = buildSavingsMonth("2026-10", [plan], []);
    const november = buildSavingsMonth("2026-11", [plan], []);
    assert.equal(october.rows[0]?.planned, 230);
    assert.equal(november.rows[0]?.planned, 190);
    assert.equal(november.rows[0]?.broughtForward, 230);
  });

  it("keeps a range amount when none of the usual days fall inside it", () => {
    const plan = epargne({
      intervals: [{ from: "2026-10-01", to: "2026-10-01", amount: 75 }],
    });
    const october = buildSavingsMonth("2026-10", [plan], []);
    assert.equal(october.rows[0]?.planned, 325);
    assert.equal(october.rows[0]?.customDates, true);
  });

  it("uses a date range amount on those days and the month amount on the others", () => {
    const plan = epargne({
      monthAmounts: [{ yearMonth: "2026-10", amount: 80 }],
      intervals: [{ from: "2026-10-16", to: "2026-10-23", amount: 30 }],
    });
    const october = buildSavingsMonth("2026-10", [plan], []);
    assert.equal(october.rows[0]?.planned, 300);
    assert.equal(october.rows[0]?.plannedOverridden, true);
    assert.equal(october.rows[0]?.customDates, true);
  });

  it("drops one month and carries the objective through it", () => {
    const plan = epargne({ omittedMonths: ["2026-10"] });
    const transfers: SavingsTransfer[] = [
      { date: "2026-10-02", fromAccountId: "td", toAccountId: "save", amount: 50 },
    ];
    const october = buildSavingsMonth("2026-10", [plan], transfers);
    assert.equal(october.rows.length, 0);

    const november = buildSavingsMonth("2026-11", [plan], transfers);
    assert.equal(november.rows[0]?.broughtForward, 0);
    assert.equal(november.rows[0]?.planned, 200);
  });

  it("lets a new objective start the month after an ended one", () => {
    const ended = { startsOn: "2026-10", endsOn: "2026-12" };
    assert.equal(savingsRangesOverlap(ended, { startsOn: "2027-01", endsOn: null }), false);
    assert.equal(savingsRangesOverlap(ended, { startsOn: "2026-12", endsOn: null }), true);
    assert.equal(
      savingsRangesOverlap({ startsOn: "2026-10", endsOn: null }, { startsOn: "2027-01", endsOn: null }),
      true,
    );
  });

  it("keeps months before the objective ends and hides the ones after", () => {
    const plan = epargne({ endsOn: "2026-10" });
    const october = buildSavingsMonth("2026-10", [plan], []);
    const november = buildSavingsMonth("2026-11", [plan], []);
    assert.equal(october.rows[0]?.planned, 250);
    assert.equal(november.rows.length, 0);
  });
});
