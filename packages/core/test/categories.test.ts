import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeCategory } from "../dist/categories.js";

const categories = [
  { id: "food", name: "Food", kind: "expense" as const, parentId: null },
  { id: "groceries", name: "Groceries", kind: "expense" as const, parentId: "food" },
  { id: "housing", name: "Housing", kind: "expense" as const, parentId: null },
  { id: "salary", name: "Salary", kind: "income" as const, parentId: null },
];

describe("placeCategory", () => {
  it("adds a category under a group of the same type", () => {
    assert.deepEqual(placeCategory({ name: "  Markets ", kind: "expense", parentId: "food" }, categories), {
      name: "Markets",
      kind: "expense",
      parentId: "food",
    });
  });

  it("rejects a duplicate name in the same group and a parent of another type", () => {
    assert.throws(
      () => placeCategory({ name: "groceries", kind: "expense", parentId: "food" }, categories),
      /already used/,
    );
    assert.throws(
      () => placeCategory({ name: "Bonus", kind: "income", parentId: "food" }, categories),
      /same type/,
    );
  });

  it("keeps a group that has categories at the top level", () => {
    assert.throws(
      () =>
        placeCategory(
          { name: "Food", kind: "expense", parentId: "housing" },
          categories,
          "food",
        ),
      /under this group/,
    );
  });
});
