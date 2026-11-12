import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { importJsonBackup, importSqliteBackup } from "../src/backup.js";
import { getHouseholdId, openDatabase } from "../src/db.js";
import { createAccount, createTransaction, exportJson } from "../src/repo.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-backup-"));
const dbPath = path.join(dir, "ledger.db");
const db = openDatabase(dbPath);

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("backup import", () => {
  it("replaces the ledger from JSON and from SQLite", () => {
    const checking = createAccount(db, { name: "Chequing", type: "checking", openingBalance: 25 });
    const savings = createAccount(db, { name: "Savings", type: "savings" });
    createTransaction(db, {
      accountId: checking.id,
      date: "2026-10-02",
      amount: 40,
      payee: "Paie",
    });
    const householdId = getHouseholdId(db);
    const stamp = "2026-10-02T00:00:00.000Z";
    db.prepare(
      `
      INSERT INTO savings_plans
        (id, household_id, name, amount, frequency, weekday, from_account_id, to_account_id,
         starts_on, ends_on, carry_in, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'CELI', 50, 'monthly', NULL, ?, ?, '2026-10', NULL, 0, ?, ?, NULL)
    `,
    ).run("plan-1", householdId, checking.id, savings.id, stamp, stamp);

    const payload = exportJson(db);
    assert.equal(payload.version, 3);
    assert.equal(payload.savingsPlans.length, 1);

    db.pragma("wal_checkpoint(TRUNCATE)");
    const sqliteCopy = path.join(dir, "copy.db");
    fs.copyFileSync(dbPath, sqliteCopy);

    db.prepare(`UPDATE accounts SET name = 'Changed' WHERE id = ?`).run(checking.id);
    const imported = importJsonBackup(db, payload);
    assert.equal(imported.transactions, 1);
    assert.equal(accountName(checking.id), "Chequing");
    assert.equal(savingsCount(), 1);

    db.prepare(`UPDATE accounts SET name = 'Changed again' WHERE id = ?`).run(checking.id);
    importSqliteBackup(db, fs.readFileSync(sqliteCopy));
    assert.equal(accountName(checking.id), "Chequing");
    assert.equal(savingsCount(), 1);

    const version2 = { ...payload, version: 2 };
    delete (version2 as { savingsPlans?: unknown }).savingsPlans;
    delete (version2 as { savingsPlanMonths?: unknown }).savingsPlanMonths;
    delete (version2 as { savingsPlanIntervals?: unknown }).savingsPlanIntervals;
    importJsonBackup(db, version2);
    assert.equal(accountName(checking.id), "Chequing");
    assert.equal(savingsCount(), 0);

    db.prepare(`UPDATE accounts SET name = 'Stay' WHERE id = ?`).run(checking.id);
    assert.throws(() => importJsonBackup(db, { version: 1 }), /not supported/);
    assert.throws(() => importSqliteBackup(db, Buffer.from("not a database")), /not a SQLite database/);
    assert.equal(accountName(checking.id), "Stay");
  });
});

function accountName(id: string): string {
  return (db.prepare(`SELECT name FROM accounts WHERE id = ?`).get(id) as { name: string }).name;
}

function savingsCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM savings_plans WHERE deleted_at IS NULL`).get() as { n: number })
    .n;
}
