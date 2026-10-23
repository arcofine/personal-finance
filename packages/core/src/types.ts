/** Default ledger currency for v1. */
export const DEFAULT_CURRENCY = "CAD" as const;

export type CurrencyCode = typeof DEFAULT_CURRENCY | string;

export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "cash"
  | "placement";

export type CategoryKind = "expense" | "income" | "transfer";

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  householdId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Optional bank / institution label (e.g. RBC, TD). */
  institution: string | null;
  /** Opening balance before any transactions. */
  openingBalance: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category {
  id: string;
  householdId: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  system: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCategoryInput {
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  parentId?: string | null;
}

/**
 * Money movement on one account.
 * Sign convention: positive increases account balance; negative decreases it.
 * Credit accounts typically carry a negative balance when money is owed.
 */
export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  payee: string | null;
  memo: string | null;
  categoryId: string | null;
  /** Shared id linking the two legs of a transfer. */
  transferGroupId: string | null;
  /** Idempotency key for CSV import (hash of date+amount+payee+account). */
  importHash: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AccountWithBalance extends Account {
  /** openingBalance + sum of non-deleted transaction amounts. */
  balance: number;
}

export interface CategorySpendRow {
  categoryId: string | null;
  categoryName: string;
  kind: CategoryKind | "uncategorized";
  total: number;
  transactionCount: number;
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency?: CurrencyCode;
  institution?: string | null;
  openingBalance?: number;
  notes?: string | null;
}

export interface UpdateAccountInput {
  name?: string;
  type?: AccountType;
  currency?: CurrencyCode;
  institution?: string | null;
  openingBalance?: number;
  notes?: string | null;
}

export interface CreateTransactionInput {
  accountId: string;
  date: string;
  amount: number;
  payee?: string | null;
  memo?: string | null;
  categoryId?: string | null;
}

export interface UpdateTransactionInput {
  accountId?: string;
  date?: string;
  amount?: number;
  payee?: string | null;
  memo?: string | null;
  categoryId?: string | null;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: number;
  memo?: string | null;
}

export type CsvBankPreset = "generic" | "rbc" | "td";

export interface CsvColumnMap {
  date: string;
  amount: string;
  payee?: string;
  memo?: string;
  /** If set, positive amounts are treated as outflows (common on some bank CSVs). */
  invertAmount?: boolean;
  dateFormat?: "ymd" | "mdy" | "dmy";
}

export interface ParsedCsvRow {
  date: string;
  amount: number;
  payee: string | null;
  memo: string | null;
  raw: Record<string, string>;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  errors: string[];
}
