import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { addDays, calendarToday } from "@pf/core";
import { importJsonBackup } from "../src/backup.js";
import { openDatabase, type Db } from "../src/db.js";
import { householdOverview } from "../src/overview.js";
import {
  createAccount,
  createTransaction,
  createTransfer,
  exportJson,
  getAccount,
  updateTransaction,
} from "../src/repo.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-scheduled-"));
const today = calendarToday();
const future = addDays(today, 14);
let seq = 0;

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("scheduled transactions", () => {
  it("credits a future transaction only after it is marked paid", () => {
    const db = freshDb();
    const account = createAccount(db, { name: "Chequing", type: "checking", openingBalance: 100 });
    const tx = createTransaction(db, {
      accountId: account.id,
      date: future,
      amount: 40,
      payee: "Paie",
    });
    assert.equal(tx.paidAt, null);
    assert.equal(tx.date, future);
    assert.equal(balance(db, account.id), 100);

    const paid = updateTransaction(db, tx.id, { paid: true });
    assert.equal(paid?.date, today);
    assert.ok(paid?.paidAt);
    assert.equal(balance(db, account.id), 140);
    db.close();
  });

  it("posts a transaction dated today immediately", () => {
    const db = freshDb();
    const account = createAccount(db, { name: "Cash", type: "cash", openingBalance: 20 });
    const tx = createTransaction(db, {
      accountId: account.id,
      date: today,
      amount: 5,
      payee: "Found",
    });
    assert.ok(tx.paidAt);
    assert.equal(balance(db, account.id), 25);
    db.close();
  });

  it("takes a future transaction back off the balance when the date moves ahead", () => {
    const db = freshDb();
    const account = createAccount(db, { name: "Savings", type: "savings", openingBalance: 0 });
    const tx = createTransaction(db, {
      accountId: account.id,
      date: today,
      amount: 15,
      payee: "Gift",
    });
    assert.equal(balance(db, account.id), 15);
    const scheduled = updateTransaction(db, tx.id, { date: future });
    assert.equal(scheduled?.paidAt, null);
    assert.equal(scheduled?.date, future);
    assert.equal(balance(db, account.id), 0);
    db.close();
  });

  it("posts both sides of a future transfer together", () => {
    const db = freshDb();
    const from = createAccount(db, { name: "From", type: "checking", openingBalance: 80 });
    const to = createAccount(db, { name: "To", type: "savings", openingBalance: 0 });
    const transfer = createTransfer(db, {
      fromAccountId: from.id,
      toAccountId: to.id,
      date: future,
      amount: 30,
    });
    assert.equal(transfer.legs[0]?.paidAt, null);
    assert.equal(balance(db, from.id), 80);
    assert.equal(balance(db, to.id), 0);

    const paid = updateTransaction(db, transfer.legs[0]!.id, { paid: true });
    assert.equal(paid?.date, today);
    assert.equal(balance(db, from.id), 50);
    assert.equal(balance(db, to.id), 30);
    const other = db
      .prepare(`SELECT date, paid_at FROM transactions WHERE id = ?`)
      .get(transfer.legs[1]!.id) as { date: string; paid_at: string | null };
    assert.equal(other.date, today);
    assert.ok(other.paid_at);
    db.close();
  });

  it("lists a scheduled bill as still due in the overview funds", () => {
    const db = freshDb();
    const account = createAccount(db, { name: "Chequing", type: "checking", openingBalance: 1000 });
    const dueDate = addDays(today, 14);
    createTransaction(db, {
      accountId: account.id,
      date: dueDate,
      amount: -75,
      payee: "Hydro",
    });
    const overview = householdOverview(db, today.slice(0, 7));
    const week = overview.weeks.find((fund) => fund.from <= dueDate && dueDate <= fund.to);
    assert.ok(week, "a funds week covers the scheduled date");
    assert.equal(week.billsDue, 75);
    assert.deepEqual(week.bills, [{ date: dueDate, name: "Hydro", amount: 75, scheduled: true }]);
    db.close();
  });

  it("keeps a scheduled row unpaid across backup restore", () => {
    const db = freshDb();
    const account = createAccount(db, { name: "Chequing", type: "checking", openingBalance: 10 });
    createTransaction(db, {
      accountId: account.id,
      date: future,
      amount: 25,
      payee: "Later",
    });
    const payload = exportJson(db);
    const later = payload.transactions.find((tx) => tx.payee === "Later");
    assert.equal(later?.paidAt, null);
    importJsonBackup(db, payload);
    const restored = exportJson(db).transactions.find((tx) => tx.payee === "Later");
    assert.equal(restored?.paidAt, null);
    assert.equal(restored?.date, future);
    const accountId = exportJson(db).accounts.find((row) => row.name === "Chequing")?.id;
    assert.ok(accountId);
    assert.equal(balance(db, accountId), 10);
    db.close();
  });
});

function freshDb(): Db {
  return openDatabase(path.join(dir, `ledger-${seq++}.db`));
}

function balance(db: Db, id: string): number {
  return getAccount(db, id)?.balance ?? Number.NaN;
}
