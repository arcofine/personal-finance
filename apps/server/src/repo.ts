import {
  categorySpend,
  computeBalance,
  importHash,
  mapCsvRows,
  columnMapForPreset,
  parseCsv,
  monthBounds,
  newId,
  nowIso,
  round2,
  type CreateAccountInput,
  type CreateTransactionInput,
  type CreateTransferInput,
  type CsvBankPreset,
  type CsvColumnMap,
  type ImportResult,
  type UpdateAccountInput,
  type UpdateTransactionInput,
} from "@pf/core";
import type { Db } from "./db.js";
import { getHouseholdId } from "./db.js";
import {
  mapAccount,
  mapAccountWithBalance,
  mapCategory,
  mapTransaction,
  type AccountRow,
  type CategoryRow,
  type TransactionRow,
} from "./mappers.js";

export function listAccounts(db: Db) {
  const rows = db
    .prepare(
      `
      SELECT a.*,
        ROUND(a.opening_balance + COALESCE((
          SELECT SUM(t.amount) FROM transactions t
          WHERE t.account_id = a.id AND t.deleted_at IS NULL
        ), 0), 2) AS balance
      FROM accounts a
      WHERE a.deleted_at IS NULL
      ORDER BY a.type, a.name
    `,
    )
    .all() as AccountRow[];
  return rows.map(mapAccountWithBalance);
}

export function getAccount(db: Db, id: string) {
  const row = db
    .prepare(
      `
      SELECT a.*,
        ROUND(a.opening_balance + COALESCE((
          SELECT SUM(t.amount) FROM transactions t
          WHERE t.account_id = a.id AND t.deleted_at IS NULL
        ), 0), 2) AS balance
      FROM accounts a
      WHERE a.id = ? AND a.deleted_at IS NULL
    `,
    )
    .get(id) as AccountRow | undefined;
  return row ? mapAccountWithBalance(row) : null;
}

export function createAccount(db: Db, input: CreateAccountInput) {
  const id = newId();
  const stamp = nowIso();
  const householdId = getHouseholdId(db);
  db.prepare(
    `
    INSERT INTO accounts
      (id, household_id, name, type, currency, institution, opening_balance, notes, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `,
  ).run(
    id,
    householdId,
    input.name.trim(),
    input.type,
    input.currency ?? "CAD",
    input.institution ?? null,
    input.openingBalance ?? 0,
    input.notes ?? null,
    stamp,
    stamp,
  );
  return getAccount(db, id)!;
}

export function updateAccount(db: Db, id: string, input: UpdateAccountInput) {
  const existing = db
    .prepare(`SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as AccountRow | undefined;
  if (!existing) return null;

  const stamp = nowIso();
  db.prepare(
    `
    UPDATE accounts SET
      name = ?, type = ?, currency = ?, institution = ?,
      opening_balance = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    input.name?.trim() ?? existing.name,
    input.type ?? existing.type,
    input.currency ?? existing.currency,
    input.institution !== undefined ? input.institution : existing.institution,
    input.openingBalance ?? existing.opening_balance,
    input.notes !== undefined ? input.notes : existing.notes,
    stamp,
    id,
  );
  return getAccount(db, id);
}

export function softDeleteAccount(db: Db, id: string): boolean {
  const stamp = nowIso();
  const result = db
    .prepare(
      `UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(stamp, stamp, id);
  return result.changes > 0;
}

export function listCategories(db: Db) {
  const rows = db
    .prepare(
      `SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY kind, name`,
    )
    .all() as CategoryRow[];
  return rows.map(mapCategory);
}

export function listTransactions(
  db: Db,
  opts: { accountId?: string; from?: string; to?: string; q?: string } = {},
) {
  const clauses = ["deleted_at IS NULL"];
  const params: unknown[] = [];
  if (opts.accountId) {
    clauses.push("account_id = ?");
    params.push(opts.accountId);
  }
  if (opts.from) {
    clauses.push("date >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("date <= ?");
    params.push(opts.to);
  }
  if (opts.q) {
    clauses.push("(LOWER(COALESCE(payee,'')) LIKE ? OR LOWER(COALESCE(memo,'')) LIKE ?)");
    const like = `%${opts.q.toLowerCase()}%`;
    params.push(like, like);
  }
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE ${clauses.join(" AND ")} ORDER BY date DESC, created_at DESC`,
    )
    .all(...params) as TransactionRow[];
  return rows.map(mapTransaction);
}

export function createTransaction(db: Db, input: CreateTransactionInput) {
  const account = getAccount(db, input.accountId);
  if (!account) throw new Error("Account not found");

  const id = newId();
  const stamp = nowIso();
  const householdId = getHouseholdId(db);
  db.prepare(
    `
    INSERT INTO transactions
      (id, household_id, account_id, date, amount, payee, memo, category_id,
       transfer_group_id, import_hash, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)
  `,
  ).run(
    id,
    householdId,
    input.accountId,
    input.date,
    round2(input.amount),
    input.payee ?? null,
    input.memo ?? null,
    input.categoryId ?? null,
    stamp,
    stamp,
  );
  return mapTransaction(
    db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as TransactionRow,
  );
}

export function updateTransaction(
  db: Db,
  id: string,
  input: UpdateTransactionInput,
) {
  const existing = db
    .prepare(`SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as TransactionRow | undefined;
  if (!existing) return null;
  if (existing.transfer_group_id) {
    throw new Error("Edit transfer legs via delete + recreate transfer for M0");
  }

  const stamp = nowIso();
  db.prepare(
    `
    UPDATE transactions SET
      account_id = ?, date = ?, amount = ?, payee = ?, memo = ?,
      category_id = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    input.accountId ?? existing.account_id,
    input.date ?? existing.date,
    input.amount !== undefined ? round2(input.amount) : existing.amount,
    input.payee !== undefined ? input.payee : existing.payee,
    input.memo !== undefined ? input.memo : existing.memo,
    input.categoryId !== undefined ? input.categoryId : existing.category_id,
    stamp,
    id,
  );
  return mapTransaction(
    db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as TransactionRow,
  );
}

export function softDeleteTransaction(db: Db, id: string): boolean {
  const existing = db
    .prepare(`SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as TransactionRow | undefined;
  if (!existing) return false;

  const stamp = nowIso();
  if (existing.transfer_group_id) {
    db.prepare(
      `UPDATE transactions SET deleted_at = ?, updated_at = ?
       WHERE transfer_group_id = ? AND deleted_at IS NULL`,
    ).run(stamp, stamp, existing.transfer_group_id);
    return true;
  }

  db.prepare(
    `UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?`,
  ).run(stamp, stamp, id);
  return true;
}

/** Create a paired transfer: -amount on from, +amount on to. */
export function createTransfer(db: Db, input: CreateTransferInput) {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Transfer requires two different accounts");
  }
  if (input.amount <= 0) throw new Error("Transfer amount must be positive");

  const from = getAccount(db, input.fromAccountId);
  const to = getAccount(db, input.toAccountId);
  if (!from || !to) throw new Error("Account not found");

  const groupId = newId();
  const fromId = newId();
  const toId = newId();
  const stamp = nowIso();
  const householdId = getHouseholdId(db);
  const amount = round2(input.amount);
  const payee = `Transfer → ${to.name}`;
  const payeeIn = `Transfer ← ${from.name}`;

  const run = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO transactions
        (id, household_id, account_id, date, amount, payee, memo, category_id,
         transfer_group_id, import_hash, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL)
    `,
    ).run(
      fromId,
      householdId,
      input.fromAccountId,
      input.date,
      -amount,
      payee,
      input.memo ?? null,
      groupId,
      stamp,
      stamp,
    );
    db.prepare(
      `
      INSERT INTO transactions
        (id, household_id, account_id, date, amount, payee, memo, category_id,
         transfer_group_id, import_hash, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL)
    `,
    ).run(
      toId,
      householdId,
      input.toAccountId,
      input.date,
      amount,
      payeeIn,
      input.memo ?? null,
      groupId,
      stamp,
      stamp,
    );
  });
  run();

  return {
    transferGroupId: groupId,
    legs: [
      mapTransaction(
        db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(fromId) as TransactionRow,
      ),
      mapTransaction(
        db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(toId) as TransactionRow,
      ),
    ],
  };
}

export function importCsv(
  db: Db,
  opts: {
    accountId: string;
    csvText: string;
    preset?: CsvBankPreset;
    columnMap?: CsvColumnMap;
  },
): ImportResult {
  const account = getAccount(db, opts.accountId);
  if (!account) throw new Error("Account not found");

  const map = opts.columnMap ?? columnMapForPreset(opts.preset ?? "generic");
  const { rows: rawRows } = parseCsv(opts.csvText);
  const { rows, errors } = mapCsvRows(rawRows, map);

  const householdId = getHouseholdId(db);
  let imported = 0;
  let skippedDuplicates = 0;

  const insert = db.prepare(`
    INSERT INTO transactions
      (id, household_id, account_id, date, amount, payee, memo, category_id,
       transfer_group_id, import_hash, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)
  `);

  const exists = db.prepare(`
    SELECT id FROM transactions
    WHERE account_id = ? AND import_hash = ? AND deleted_at IS NULL
  `);

  const run = db.transaction(() => {
    for (const row of rows) {
      const hash = importHash(opts.accountId, row.date, row.amount, row.payee);
      if (exists.get(opts.accountId, hash)) {
        skippedDuplicates++;
        continue;
      }
      const stamp = nowIso();
      insert.run(
        newId(),
        householdId,
        opts.accountId,
        row.date,
        row.amount,
        row.payee,
        row.memo,
        hash,
        stamp,
        stamp,
      );
      imported++;
    }
  });
  run();

  return { imported, skippedDuplicates, errors };
}

export function reportCategorySpend(
  db: Db,
  yearMonth: string,
) {
  const { from, to } = monthBounds(yearMonth);
  const txs = listTransactions(db, { from, to });
  const cats = listCategories(db);
  return {
    yearMonth,
    from,
    to,
    rows: categorySpend(txs, cats),
  };
}

export function exportJson(db: Db) {
  const household = db.prepare(`SELECT * FROM household LIMIT 1`).get();
  const accounts = db
    .prepare(`SELECT * FROM accounts WHERE deleted_at IS NULL`)
    .all()
    .map((r) => mapAccount(r as AccountRow));
  const categories = listCategories(db);
  const transactions = listTransactions(db);
  return {
    exportedAt: nowIso(),
    version: 1,
    currencyDefault: "CAD",
    household,
    accounts,
    categories,
    transactions,
  };
}

export function accountBalanceCheck(db: Db, accountId: string) {
  const account = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(accountId) as AccountRow | undefined;
  if (!account) return null;
  const txs = db
    .prepare(
      `SELECT amount, deleted_at FROM transactions WHERE account_id = ?`,
    )
    .all(accountId) as { amount: number; deleted_at: string | null }[];
  return computeBalance(account.opening_balance, txs.map((t) => ({
    amount: t.amount,
    deletedAt: t.deleted_at,
  })));
}
