import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  biweeklyPaydaysInMonth,
  buildSalaryMonth,
  occurrencesFor,
  weekdaysInMonth,
} from "../dist/schedule.js";

describe("occurrences", () => {
  it("counts Fridays in October 2026 and November 2026", () => {
    assert.deepEqual(weekdaysInMonth("2026-10", "friday").dates, [
      "2026-10-02",
      "2026-10-09",
      "2026-10-16",
      "2026-10-23",
      "2026-10-30",
    ]);
    assert.equal(weekdaysInMonth("2026-11", "friday").count, 4);
  });

  it("steps bi-weekly from an anchor date", () => {
    assert.deepEqual(occurrencesFor("2026-11", "biweekly", null, "2026-10-02").dates, [
      "2026-11-13",
      "2026-11-27",
    ]);
    assert.equal(occurrencesFor("2026-10", "monthly", null, null).count, 1);
  });
});

describe("biweekly paydays", () => {
  it("includes earlier paydays in the month when the anchor is a later one", () => {
    assert.deepEqual(biweeklyPaydaysInMonth("2026-10", "2026-10-30").dates, [
      "2026-10-02",
      "2026-10-16",
      "2026-10-30",
    ]);
  });

  it("alternates two people a week apart and totals 26 pays in 2026", () => {
    const mine = biweeklyPaydaysInMonth("2026-10", "2026-10-02").dates;
    const partner = biweeklyPaydaysInMonth("2026-10", "2026-10-09").dates;
    assert.deepEqual(mine, ["2026-10-02", "2026-10-16", "2026-10-30"]);
    assert.deepEqual(partner, ["2026-10-09", "2026-10-23"]);
    assert.equal(mine.some((date) => partner.includes(date)), false);

    let mineYear = 0;
    let partnerYear = 0;
    for (let month = 1; month <= 12; month += 1) {
      const yearMonth = `2026-${String(month).padStart(2, "0")}`;
      mineYear += biweeklyPaydaysInMonth(yearMonth, "2026-01-02").count;
      partnerYear += biweeklyPaydaysInMonth(yearMonth, "2026-01-09").count;
    }
    assert.equal(mineYear, 26);
    assert.equal(partnerYear, 26);
  });
});

describe("buildSalaryMonth", () => {
  it("credits each bi-weekly payday and skips earlier months", () => {
    const salary = {
      id: "salary",
      name: "Salary",
      amount: 1500,
      anchorDate: "2026-10-02",
      startsOn: "2026-11",
      categoryId: null,
      accountId: null,
    };
    assert.equal(buildSalaryMonth("2026-10", [salary], []).length, 0);

    const november = buildSalaryMonth("2026-11", [salary], []);
    assert.deepEqual(november[0]?.dates, ["2026-11-13", "2026-11-27"]);
    assert.equal(november[0]?.expected, 3000);
    assert.equal(november[0]?.receivedSource, "none");
  });

  it("uses the paycheck amount in effect each month", () => {
    const salary = {
      id: "salary",
      name: "Salary",
      amount: 2950,
      rates: [
        { effectiveOn: "2026-03", amount: 3100 },
        { effectiveOn: "2026-07", amount: 3400 },
      ],
      anchorDate: "2026-01-02",
      startsOn: "2026-01",
      categoryId: null,
      accountId: null,
    };
    const january = buildSalaryMonth("2026-01", [salary], []);
    assert.deepEqual(january[0]?.payAmounts, [2950, 2950, 2950]);
    assert.equal(january[0]?.expected, 8850);

    const march = buildSalaryMonth("2026-03", [salary], []);
    assert.ok(march[0]?.payAmounts.every((amount) => amount === 3100));
    assert.equal(march[0]?.expected, 3100 * (march[0]?.occurrences ?? 0));

    const july = buildSalaryMonth("2026-07", [salary], []);
    assert.ok(july[0]?.payAmounts.every((amount) => amount === 3400));
    assert.equal(july[0]?.expected, 3400 * (july[0]?.occurrences ?? 0));
  });

  it("uses category receipts when a salary is linked", () => {
    const november = buildSalaryMonth(
      "2026-11",
      [
        {
          id: "salary",
          name: "Salary",
          amount: 100,
          anchorDate: "2026-11-13",
          startsOn: "2026-11",
          categoryId: "cat-salary",
          accountId: null,
        },
      ],
      [{ salaryId: "salary", total: 400 }],
    );
    assert.equal(november[0]?.received, 400);
    assert.equal(november[0]?.receivedSource, "category");
  });
});
