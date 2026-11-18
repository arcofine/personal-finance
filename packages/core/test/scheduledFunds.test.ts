import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeekFunds, type WeekFundAccount } from "../dist/weekFunds.js";

const checking: WeekFundAccount = { id: "rbc", type: "checking", openingBalance: 1000 };

function weekOf(funds: ReturnType<typeof buildWeekFunds>, from: string) {
  return funds.find((week) => week.from === from);
}

describe("buildWeekFunds with scheduled register rows", () => {
  it("uses the scheduled bill in place of the planned bill", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-12",
      toMonth: "2026-12",
      accounts: [checking],
      movements: [],
      plans: [
        {
          name: "Hydro",
          kind: "expense",
          accountId: "rbc",
          categoryId: "utilities",
          dates: [{ date: "2026-12-03", amount: 60 }],
          recorded: 0,
        },
      ],
      savings: [],
      scheduled: [
        {
          accountId: "rbc",
          date: "2026-12-03",
          amount: -75,
          categoryId: "utilities",
          payee: "Hydro",
          transferGroupId: null,
        },
      ],
    });
    const week = weekOf(funds, "2026-12-01");
    assert.equal(week?.billsDue, 75);
    assert.deepEqual(week?.bills, [{ date: "2026-12-03", name: "Hydro", amount: 75, scheduled: true }]);
    assert.equal(week?.closing, 925);
  });

  it("adds a scheduled pay that matches no plan as pay still coming", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-12",
      toMonth: "2026-12",
      accounts: [{ ...checking, openingBalance: 0 }],
      movements: [],
      plans: [],
      savings: [],
      scheduled: [
        {
          accountId: "rbc",
          date: "2026-12-10",
          amount: 1500,
          categoryId: null,
          payee: "Bonus",
          transferGroupId: null,
        },
      ],
    });
    const week = weekOf(funds, "2026-12-07");
    assert.equal(week?.incomeDue, 1500);
    assert.equal(week?.closing, 1500);
  });

  it("does not count a scheduled row that is a transfer", () => {
    const funds = buildWeekFunds({
      fromMonth: "2026-12",
      toMonth: "2026-12",
      accounts: [checking],
      movements: [],
      plans: [],
      savings: [],
      scheduled: [
        {
          accountId: "rbc",
          date: "2026-12-04",
          amount: -200,
          categoryId: null,
          payee: "Transfer → Epargne",
          transferGroupId: "g1",
        },
      ],
    });
    assert.equal(weekOf(funds, "2026-12-01")?.billsDue, 0);
  });
});
