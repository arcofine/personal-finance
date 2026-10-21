# PersonalFinance — Project context

**Owner:** Armando Neto  
**Phase:** M0 scaffold exists (ledger skeleton); product decisions locked in the plan

## Goals

- Shared household budgeting and spending in one place (Armando + wife, one ledger)
- Monthly category envelopes + weekly cashflows (income credited weekly) + weekly expense forecast
- Multiple bank accounts (RBC / TD Canada); CSV-first
- Narrow investing v1: CC → placement transfers + placement balances (not full holdings)
- **Local-first** v1: browser + local server + SQLite
- Later: mobile / multi-device (sync approach undecided)

## Locked constraints

- Packaging: **browser + local server** (no Tauri in v1)
- Currency: **CAD** single-currency MVP (locked unless user overrides)
- Banks for presets / later APIs: **RBC and TD**
- Household: two people, shared dataset — not single-person-only; no multi-user cloud auth in v1
- Investing depth: placement transfers + balances only in v1
- App scaffold lives in this repo (M0: web + local API + core); see README for run instructions
- Privacy-sensitive: bank API sync post-MVP; CSV/manual first
- Schema + domain logic portable for a future mobile client

## Remaining open decisions

- **Sync privacy / vendor** for future multi-device — decide later (self-hosted encrypted vs managed vendor)

Full detail: [product-plan.md](./product-plan.md)

## Canonical plan

→ [product-plan.md](./product-plan.md)
