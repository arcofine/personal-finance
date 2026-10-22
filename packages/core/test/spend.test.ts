import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountForBalance } from "../dist/spend.js";

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
