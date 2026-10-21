# PersonalFinance

Local-first household finance app for a two-person shared ledger (CAD).  
**v1 packaging:** browser UI + local Node API + SQLite — no Tauri, no bank APIs.

## Monorepo layout

| Path | Package | Role |
|------|---------|------|
| `apps/web` | `@pf/web` | React + TypeScript + Vite UI |
| `apps/server` | `@pf/server` | Local Express API + `better-sqlite3` |
| `packages/core` | `@pf/core` | Shared domain (types, CSV import, category spend) |

## Prerequisites

- **Node.js 20+** (npm workspaces)
- Native build tools for `better-sqlite3` (usually fine on macOS/Linux; on Windows use the usual VS Build Tools)

## Install

```bash
npm install
npm run build:core
```

`build:core` compiles the shared package that both the API and UI import.

## Run locally

Use two terminals (or run both scripts yourself):

```bash
# Terminal 1 — API (SQLite under ./data by default)
npm run dev:server

# Terminal 2 — Vite UI (proxies /api → :8787)
npm run dev:web
```

- UI: http://localhost:5173  
- API: http://localhost:8787  
- Health: http://localhost:8787/api/health  

Optional env (see `.env.example`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `PF_DB_PATH` | `./data/personal-finance.db` | SQLite file path |
| `PF_PORT` | `8787` | API port |
| `PF_CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |

## M0 features

- **Accounts** — checking / savings / credit / cash / placement (CAD)
- **Transactions** — manual entry, edit/delete, search
- **Transfers** — paired legs between accounts (including CC → placement)
- **CSV import** — generic importer with duplicate detection; RBC/TD presets are stubs
- **Category spend** — monthly totals by category (transfers excluded)
- **Backup** — download JSON or a SQLite `.db` copy

Default categories are seeded on first DB open.

## Sign convention

Transaction amounts are signed relative to the account: **positive increases balance**, **negative decreases**. Credit accounts typically show a negative balance when you owe money.

## Out of scope for M0 (next)

- Monthly category envelopes
- Weekly cashflow (income credited weekly) and weekly expense forecast UI
- Bank / Plaid APIs, mobile sync, full holdings/lots

Schema leaves room for `budget_periods` / `budget_lines` and soft-delete / UUID fields for a future sync path.

## Production-ish build

```bash
npm run build
npm start          # serves API from apps/server/dist
# serve apps/web/dist with any static host, or point Vite preview at it
```

## License

Private / personal use unless otherwise stated.
