import type {
  Account,
  AccountType,
  AccountWithBalance,
  Category,
  CategoryKind,
  Transaction,
} from "@pf/core";

export interface AccountRow {
  id: string;
  household_id: string;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
  opening_balance: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  balance?: number;
}

export interface CategoryRow {
  id: string;
  household_id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  system: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TransactionRow {
  id: string;
  household_id: string;
  account_id: string;
  date: string;
  amount: number;
  payee: string | null;
  memo: string | null;
  category_id: string | null;
  transfer_group_id: string | null;
  import_hash: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    institution: row.institution,
    openingBalance: row.opening_balance,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapAccountWithBalance(row: AccountRow): AccountWithBalance {
  return {
    ...mapAccount(row),
    balance: row.balance ?? row.opening_balance,
  };
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    system: !!row.system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    householdId: row.household_id,
    accountId: row.account_id,
    date: row.date,
    amount: row.amount,
    payee: row.payee,
    memo: row.memo,
    categoryId: row.category_id,
    transferGroupId: row.transfer_group_id,
    importHash: row.import_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
