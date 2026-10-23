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

/**
 * Check a new or edited category.
 * Groups are top-level. A category sits under one group of the same type.
 * A group that already has categories under it stays at the top.
 */
export function placeCategory(
  input: { name: unknown; kind: unknown; parentId?: unknown },
  categories: Pick<Category, "id" | "name" | "kind" | "parentId">[],
  editingId?: string,
): { name: string; kind: CategoryKind; parentId: string | null } {
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("Name is required");
  const name = input.name.trim();
  if (name.length > 80) throw new Error("Use a shorter name");
  if (input.kind !== "expense" && input.kind !== "income" && input.kind !== "transfer") {
    throw new Error("Pick expense, income, or transfer");
  }
  const kind: CategoryKind = input.kind;
  const current = editingId ? categories.find((category) => category.id === editingId) : undefined;
  if (editingId && !current) throw new Error("Category not found");
  if (current && current.kind !== kind) throw new Error("A category keeps its type");

  const parentId =
    input.parentId === undefined || input.parentId === null || input.parentId === ""
      ? null
      : String(input.parentId);
  if (parentId) {
    const parent = categories.find((category) => category.id === parentId);
    if (!parent) throw new Error("Group not found");
    if (parent.kind !== kind) throw new Error("The group has to be the same type");
    if (parent.parentId) throw new Error("Put this under a top-level group");
    if (parent.id === editingId) throw new Error("A category cannot sit under itself");
    const hasChildren = categories.some((category) => category.parentId === editingId);
    if (hasChildren) {
      throw new Error("Move the categories under this group before it can sit under another group");
    }
  }

  const key = name.toLocaleLowerCase("en-CA");
  const duplicate = categories.some(
    (category) =>
      category.id !== editingId &&
      category.kind === kind &&
      (category.parentId ?? null) === parentId &&
      category.name.trim().toLocaleLowerCase("en-CA") === key,
  );
  if (duplicate) throw new Error("That name is already used here");

  return { name, kind, parentId };
}

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
