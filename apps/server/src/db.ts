import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  buildDefaultCategories,
  DEFAULT_CURRENCY,
  newId,
  nowIso,
} from "@pf/core";

export type Db = Database.Database;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','placement')),
  currency TEXT NOT NULL DEFAULT 'CAD',
  institution TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  parent_id TEXT REFERENCES categories(id),
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  payee TEXT,
  memo TEXT,
  category_id TEXT REFERENCES categories(id),
  transfer_group_id TEXT,
  import_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_import_hash
  ON transactions(account_id, import_hash)
  WHERE import_hash IS NOT NULL AND deleted_at IS NULL;

-- Reserved for near-term envelopes / weekly cashflow (not used in M0 UI).
CREATE TABLE IF NOT EXISTS budget_periods (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  year_month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, year_month)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id TEXT PRIMARY KEY,
  budget_period_id TEXT NOT NULL REFERENCES budget_periods(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (budget_period_id, category_id)
);
`;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  ensureHousehold(db);
  return db;
}

function ensureHousehold(db: Db): string {
  const existing = db.prepare(`SELECT id FROM household LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const id = newId();
  const stamp = nowIso();
  const seed = db.transaction(() => {
    db.prepare(
      `INSERT INTO household (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(id, "Household", stamp, stamp);

    const cats = buildDefaultCategories(id);
    const insert = db.prepare(`
      INSERT INTO categories
        (id, household_id, name, kind, parent_id, system, created_at, updated_at, deleted_at)
      VALUES
        (@id, @householdId, @name, @kind, @parentId, @system, @createdAt, @updatedAt, @deletedAt)
    `);
    for (const c of cats) {
      insert.run({
        id: c.id,
        householdId: c.householdId,
        name: c.name,
        kind: c.kind,
        parentId: c.parentId,
        system: c.system ? 1 : 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        deletedAt: c.deletedAt,
      });
    }
  });
  seed();
  return id;
}

export function getHouseholdId(db: Db): string {
  const row = db.prepare(`SELECT id FROM household LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (!row) throw new Error("No household row — database not initialized");
  return row.id;
}

export { DEFAULT_CURRENCY };
