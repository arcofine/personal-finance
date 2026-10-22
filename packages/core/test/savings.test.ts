import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSavingsMonth, type SavingsPlanTemplate, type SavingsTransfer } from "../dist/savings.js";

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
  it("plans every Friday and counts a matching transfer toward the objective", () => {
    const transfers: SavingsTransfer[] = [
      { date: "2026-10-22", fromAccountId: "td", toAccountId: "save", amount: 200 },
      { date: "2026-10-15", fromAccountId: "rbc", toAccountId: "save", amount: 80 },
    ];
    const october = buildSavingsMonth("2026-10", [epargne()], transfers);
    const row = october.rows[0];
    assert.equal(row?.occurrences, 5);
    assert.equal(row?.planned, 250);
    assert.equal(row?.saved, 200);
    assert.equal(row?.remaining, 50);
    assert.equal(october.totals.remaining, 50);
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
});
