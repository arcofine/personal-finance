import type { Category, CategoryKind } from "./types.js";
import { newId, nowIso } from "./ids.js";

interface SeedDef {
  name: string;
  kind: CategoryKind;
  children?: string[];
}

/** Default household category tree for CAD spending / income. */
export const DEFAULT_CATEGORY_TREE: SeedDef[] = [
  {
    name: "Housing",
    kind: "expense",
    children: ["Rent / Mortgage", "Utilities", "Internet", "Insurance"],
  },
  {
    name: "Food",
    kind: "expense",
    children: ["Groceries", "Restaurants", "Coffee"],
  },
  {
    name: "Transport",
    kind: "expense",
    children: ["Fuel", "Transit", "Parking", "Car"],
  },
  {
    name: "Health",
    kind: "expense",
    children: ["Pharmacy", "Dental", "Medical"],
  },
  {
    name: "Lifestyle",
    kind: "expense",
    children: ["Entertainment", "Subscriptions", "Shopping", "Personal care"],
  },
  {
    name: "Family",
    kind: "expense",
    children: ["Childcare", "Education", "Gifts"],
  },
  {
    name: "Fees",
    kind: "expense",
    children: ["Bank fees", "Taxes"],
  },
  {
    name: "Income",
    kind: "income",
    children: ["Salary", "Side income", "Interest", "Other income"],
  },
  {
    name: "Transfers",
    kind: "transfer",
    children: ["Account transfer", "To placement"],
  },
];

export function buildDefaultCategories(householdId: string): Category[] {
  const stamp = nowIso();
  const out: Category[] = [];

  for (const root of DEFAULT_CATEGORY_TREE) {
    const parentId = newId();
    out.push({
      id: parentId,
      householdId,
      name: root.name,
      kind: root.kind,
      parentId: null,
      system: true,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });
    for (const child of root.children ?? []) {
      out.push({
        id: newId(),
        householdId,
        name: child,
        kind: root.kind,
        parentId,
        system: true,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      });
    }
  }

  return out;
}
