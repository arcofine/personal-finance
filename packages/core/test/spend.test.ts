import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountForBalance, computeBalance } from "../dist/spend.js";

describe("amountForBalance", () => {
  it("takes an expense out of the balance whether the amount is typed positive or negative", () => {
    assert.equal(amountForBalance(42.5, "expense"), -42.5);
    assert.equal(amountForBalance(-42.5, "expense"), -42.5);
  });

  it("keeps the entered sign for income and uncategorized amounts", () => {
    assert.equal(amountForBalance(1500, "income"), 1500);
    assert.equal(amountForBalance(-20, null), -20);
  });
});

describe("computeBalance", () => {
  it("leaves a scheduled transaction out of the balance", () => {
    assert.equal(
      computeBalance(100, [
        { amount: 40, deletedAt: null, paidAt: null },
        { amount: -15, deletedAt: null, paidAt: "2026-11-18T00:00:00.000Z" },
      ]),
      85,
    );
  });
});
