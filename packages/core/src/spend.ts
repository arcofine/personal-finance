import type { Category, CategoryKind, CategorySpendRow, Transaction } from "./types.js";

export interface SpendFilter {
  /** Inclusive YYYY-MM-DD */
  from?: string;
  /** Inclusive YYYY-MM-DD */
  to?: string;
  /** If true, include transfer legs (default false). */
  includeTransfers?: boolean;
}

/**
 * Aggregate spending (and income) by category for a period.
 * Transfer legs are excluded by default so CC → placement does not inflate spend.
 */
export function categorySpend(
  transactions: Transaction[],
  categories: Category[],
  filter: SpendFilter = {},
): CategorySpendRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<
    string,
    { total: number; count: number; category: Category | null }
  >();

  for (const tx of transactions) {
    if (tx.deletedAt) continue;
    if (filter.from && tx.date < filter.from) continue;
    if (filter.to && tx.date > filter.to) continue;
    if (!filter.includeTransfers && tx.transferGroupId) continue;

    const key = tx.categoryId ?? "__uncategorized__";
    const cat = tx.categoryId ? (byId.get(tx.categoryId) ?? null) : null;
    const row = totals.get(key) ?? { total: 0, count: 0, category: cat };
    row.total += tx.amount;
    row.count += 1;
    totals.set(key, row);
  }

  const rows: CategorySpendRow[] = [];
  for (const [key, row] of totals) {
    if (key === "__uncategorized__") {
      rows.push({
        categoryId: null,
        categoryName: "Uncategorized",
        kind: "uncategorized",
        total: round2(row.total),
        transactionCount: row.count,
      });
    } else {
      rows.push({
        categoryId: row.category?.id ?? key,
        categoryName: row.category?.name ?? "Unknown",
        kind: row.category?.kind ?? "expense",
        total: round2(row.total),
        transactionCount: row.count,
      });
    }
  }

  // Expenses (negative totals) first by magnitude, then income.
  rows.sort((a, b) => a.total - b.total);
  return rows;
}

/** First and last day of a calendar month (YYYY-MM). */
export function monthBounds(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) throw new Error(`Invalid year-month: ${yearMonth}`);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * An expense category always leaves the account. Entering 42.50 or -42.50
 * both reduce the balance by 42.50. Other categories keep the sign entered.
 */
export function amountForBalance(amount: number, kind: CategoryKind | null): number {
  const rounded = round2(amount);
  if (kind === "expense") return round2(-Math.abs(rounded));
  return rounded;
}

export function computeBalance(
  openingBalance: number,
  transactions: Pick<Transaction, "amount" | "deletedAt">[],
): number {
  let sum = openingBalance;
  for (const tx of transactions) {
    if (tx.deletedAt) continue;
    sum += tx.amount;
  }
  return round2(sum);
}
