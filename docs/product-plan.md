# PersonalFinance — Product & Architecture Plan

**Owner:** Armando Neto  
**Status:** Decisions locked (planning); no code scaffold yet  
**Scope:** Local-first household finance app → future multi-device / mobile

---

## 1. Product vision

A private, local-first personal finance app for a two-person household (Armando + wife) sharing one ledger. Budgeting, weekly cashflow awareness, and simple placement-account tracking form one coherent money picture—not disconnected tools. Banks stay sources of truth for balances; the app owns categories, envelopes, forecasts, and “where did money go?” V1 is **browser UI + local server** on your machine; later sync/mobile reuse the same model without assuming single-person-only data.

---

## 2. Locked decisions

| Topic | Decision |
|-------|----------|
| **Packaging** | Browser-only + local server for v1 (**no Tauri**) |
| **Currency** | Single-currency MVP — **CAD** (locked unless user overrides). RBC + TD → Canada |
| **Budgeting** | Monthly category envelopes **+** weekly cashflows (income credited weekly) **+** weekly expense forecast |
| **Investing v1** | Narrowed: track transfers from cash/chequing (“CC”) into placement / investment accounts, plus those accounts’ balances. **No** full holdings / lots / dividends in v1 |
| **Banks** | RBC and TD (Canada) — CSV presets now; APIs later |
| **Household** | Two people, one shared ledger dataset. Not multi-user cloud auth in v1, but model must not assume single-person-only |

---

## 3. MVP scope vs later

### Ships in v1 (browser + local server)

| Area | In MVP |
|------|--------|
| **Accounts** | Manual create/edit: checking/chequing (“CC”), savings, credit, cash, placement/investment; balance + institution label |
| **Transactions** | Manual entry + CSV import (RBC/TD presets); edit, split, transfer between own accounts; search/filter |
| **Categories** | Hierarchical categories; default set + custom |
| **Budgets** | Monthly envelope-style limits per category/group |
| **Cashflow & forecast** | Weekly cashflows (income credited weekly); weekly expense forecast to track dépenses |
| **Investing (narrow)** | Transfers CC → placement accounts + placement account balances only |
| **Reports** | Spending by category (month/YTD); weekly cashflow/forecast views; simple net worth from account balances |
| **Data** | Local SQLite; optional encrypt-at-rest; full export (JSON/SQLite) and restore |
| **Household** | Shared household dataset (two people); no cloud multi-user auth |

### Explicitly later (not v1)

- Full holdings / lots / dividends / portfolio allocation UI
- Bank/broker API sync (Plaid / Open Banking) for RBC/TD and others
- Tauri/desktop shell; mobile apps; multi-device live sync
- Shared household cloud permissions / multi-user auth
- Goals, bills calendar, debt payoff planners, advanced analytics
- Receipt OCR, rich rules engines beyond simple merchant → category
- Crypto, real estate, or full double-entry accounting UI

**Cut rule:** if it needs a third-party credential, a phone, a sync server, or full securities tracking, it is not MVP.

---

## 4. Core entities

```
Institution (optional) ──< Account ──< Transaction
                              │              │
                              │              ├── Category (nullable for transfers)
                              │              └── TransferLink (pair of legs)
                              │
BudgetPeriod ──< BudgetLine ──> Category
WeeklyCashflow / WeeklyForecast ──> (derived from txs + income schedule)
PlacementAccount = Account(type: placement/investment)  // balances + inbound transfers from CC
```

| Entity | Role |
|--------|------|
| **Account** | Wallet/ledger: type (`checking` / `savings` / `credit` / `cash` / `placement`), currency (**CAD** default), balance from txs or snapshot |
| **Transaction** | Money movement: date, amount, payee, memo, category, account_id; transfers link from/to (including CC → placement) |
| **Category** | Spend/income taxonomy; parent/child; system vs user |
| **Budget / BudgetLine** | Calendar-month envelope per category or group |
| **WeeklyCashflow** | Week-scoped income credit + related movements (income credited weekly) |
| **WeeklyForecast** | Forward-looking weekly expense forecast for dépenses tracking |
| **Household** | Shared dataset for two people; no per-user cloud auth in v1 |

**Design notes**

- Prefer **append-friendly transaction history**; balance = opening + sum(txs) (document credit sign conventions).
- Investing in v1 is **placement transfers + balances**, not holdings/lots.
- Stable UUIDs, `updated_at`, soft `deleted_at` so future sync/merge does not require a schema rewrite.
- Model may tag who entered a tx later; do not hard-code “one person owns everything.”

---

## 5. Local-first architecture & migration path

### Now (v1)

```
[Browser UI] ──> [Local API server] ──> [SQLite]
      │                                      │
      └──────── export/import (JSON / .db) ──┘
```

- Primary store: **SQLite** on disk.
- UI is browser; persistence via **local API server** — never treat browser localStorage as source of truth.
- Domain logic (categorize, envelopes, weekly cashflow/forecast, placement rollups) lives in a **shared TypeScript core package**, not in React components.
- **No Tauri** in v1.

### Sync options when going multi-device (pick later; design for any)

| Option | How it works | Tradeoff |
|--------|--------------|----------|
| **A. Cloud sync** | App server + auth; CRDT or versioned rows | Best UX; host or buy sync; privacy depends on encryption |
| **B. Encrypted backup relay** | Periodic encrypted blob; full restore | Simple; weak concurrent edits |
| **C. Export/import only** | Move JSON/SQLite between devices | Zero infra; friction |

**Migration rule:** same schema and domain API for local SQLite or a future synced replica. Mobile/desktop shells consume `core`; do not invent a second schema.

---

## 6. Recommended tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Packaging | **Browser + local API server** | Locked for v1; no Tauri-first path |
| UI | **React + TypeScript + Vite** | Fast web UI; reusable patterns for later mobile/webview |
| Data | **SQLite** via `better-sqlite3` (or equivalent) on the local server | Portable file; easy backup |
| Domain | **Shared TS package** (`core`: entities, importers, budget + weekly math) | Later clients reuse without rewrite |
| Charts | Lightweight (e.g. Recharts or Observable Plot) | Category spend, weekly forecast, balances |

**Why this does not paint into a corner:** domain + SQLite are client-agnostic. A future Capacitor / React Native / optional Tauri shell can reuse `core`. Keep business rules out of UI-only code.

### Alternative (not chosen for v1)

**Flutter + Drift** — stronger desktop+mobile early; slower for web-first CSV iteration. Revisit only if mobile-first becomes the priority.

---

## 7. Bank connectivity (multi-account)

| Approach | MVP | Later | Privacy / local |
|----------|-----|-------|-----------------|
| **Manual entry** | Yes | Keep | Best privacy |
| **CSV / OFX / QFX** | Yes — **RBC & TD presets** primary ingest | Keep; improve | Stays on machine if import is local |
| **Open Banking / Plaid-like** | No | Yes (Canada / RBC+TD first) | Tokens leave device; needs thin backend |

**MVP stance:** named Accounts per bank product; download statements; **idempotent import** (hash date+amount+payee+account).

**Later stance:** one aggregator writing into the same `Transaction` table. Historical reads must work offline from local data.

---

## 8. Open decisions (still unresolved)

- **Sync privacy / vendor for future multi-device:** encrypted local-only / self-hosted sync vs managed sync vendor — **decide later**.

Everything else in §2 is locked.

---

## 9. Suggested first build milestone (after plan approval)

**Milestone M0 — “Ledger skeleton” (no banks polish, no charts polish):**

1. Vite + React + TS app + local API + `core` package + SQLite (configurable path).
2. Account CRUD + Transaction CRUD (including transfers, especially CC → placement).
3. Seed default categories; attach to transactions.
4. Generic CSV import with duplicate detection (RBC/TD presets can follow immediately after).
5. Screens: account list → register; monthly spend by category.

**Near-term after M0 (still early):** weekly cashflow (income credited weekly) and weekly expense forecast for dépenses — before full investing/holdings work (v1 investing stays placement transfers + balances only).

**Done when (M0):** create accounts (including placement), import a CSV, categorize spends, see monthly category totals, export SQLite/JSON backup. Envelopes + weekly cashflow/forecast are the next slice; no holdings UI in v1.
