import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CSV_PRESET_STATUS } from "@pf/core";
import { openDatabase } from "./db.js";
import * as repo from "./repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

const PORT = Number(process.env.PF_PORT ?? 8787);
const CORS_ORIGIN = process.env.PF_CORS_ORIGIN ?? "http://localhost:5173";
const DB_PATH =
  process.env.PF_DB_PATH ??
  path.join(rootDir, "data", "personal-finance.db");

const db = openDatabase(DB_PATH);
const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dbPath: DB_PATH });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    currency: "CAD",
    csvPresets: CSV_PRESET_STATUS,
    next: [
      "Monthly category envelopes",
      "Weekly cashflow (income credited weekly)",
      "Weekly expense forecast",
    ],
    outOfScopeM0: [
      "Bank APIs / Plaid",
      "Mobile sync",
      "Full holdings / lots",
    ],
  });
});

// —— Accounts ——
app.get("/api/accounts", (_req, res) => {
  res.json(repo.listAccounts(db));
});

app.get("/api/accounts/:id", (req, res) => {
  const account = repo.getAccount(db, req.params.id);
  if (!account) return res.status(404).json({ error: "Not found" });
  res.json(account);
});

app.post("/api/accounts", (req, res) => {
  try {
    const { name, type } = req.body ?? {};
    if (!name || !type) {
      return res.status(400).json({ error: "name and type are required" });
    }
    const account = repo.createAccount(db, req.body);
    res.status(201).json(account);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/accounts/:id", (req, res) => {
  try {
    const account = repo.updateAccount(db, req.params.id, req.body ?? {});
    if (!account) return res.status(404).json({ error: "Not found" });
    res.json(account);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  const ok = repo.softDeleteAccount(db, req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// —— Categories ——
app.get("/api/categories", (_req, res) => {
  res.json(repo.listCategories(db));
});

// —— Transactions ——
app.get("/api/transactions", (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(repo.listTransactions(db, { accountId, from, to, q }));
});

app.post("/api/transactions", (req, res) => {
  try {
    const { accountId, date, amount } = req.body ?? {};
    if (!accountId || !date || amount === undefined) {
      return res.status(400).json({ error: "accountId, date, and amount are required" });
    }
    const tx = repo.createTransaction(db, req.body);
    res.status(201).json(tx);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/transactions/:id", (req, res) => {
  try {
    const tx = repo.updateTransaction(db, req.params.id, req.body ?? {});
    if (!tx) return res.status(404).json({ error: "Not found" });
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/transactions/:id", (req, res) => {
  const ok = repo.softDeleteTransaction(db, req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

app.post("/api/transfers", (req, res) => {
  try {
    const { fromAccountId, toAccountId, date, amount } = req.body ?? {};
    if (!fromAccountId || !toAccountId || !date || amount === undefined) {
      return res.status(400).json({
        error: "fromAccountId, toAccountId, date, and amount are required",
      });
    }
    const result = repo.createTransfer(db, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// —— CSV import ——
app.post("/api/import/csv", (req, res) => {
  try {
    const { accountId, csvText, preset, columnMap } = req.body ?? {};
    if (!accountId || typeof csvText !== "string") {
      return res.status(400).json({ error: "accountId and csvText are required" });
    }
    const result = repo.importCsv(db, { accountId, csvText, preset, columnMap });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// —— Reports ——
app.get("/api/reports/category-spend", (req, res) => {
  try {
    const now = new Date();
    const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const yearMonth =
      typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : fallback;
    res.json(repo.reportCategorySpend(db, yearMonth));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// —— Backup / export ——
app.get("/api/backup/json", (_req, res) => {
  const payload = repo.exportJson(db);
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="personal-finance-${dateStamp()}.json"`,
  );
  res.send(JSON.stringify(payload, null, 2));
});

app.get("/api/backup/sqlite", (_req, res) => {
  // Checkpoint WAL so the on-disk file is consistent, then stream a copy.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const filename = `personal-finance-${dateStamp()}.db`;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(DB_PATH).pipe(res);
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  },
);

app.listen(PORT, () => {
  console.log(`PersonalFinance API listening on http://localhost:${PORT}`);
  console.log(`SQLite: ${DB_PATH}`);
});

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
