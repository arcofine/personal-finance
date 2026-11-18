# Agent instructions — PersonalFinance

Before writing or changing code, **always read**:

1. [`docs/product-plan.md`](./docs/product-plan.md)
2. [`docs/project-context.md`](./docs/project-context.md)
3. [`docs/preferences.md`](./docs/preferences.md)

Treat those files as source of truth over chat memory. If a request conflicts with them, follow the docs unless Armando explicitly overrides.

## Defaults

- Work in this local checkout; prefer local agents over cloud unless asked
- Browser + local Node API + SQLite (no Tauri in v1)
- CAD; RBC/TD; household of two on one ledger
- Budgets: monthly envelopes, fixed expenses, month-to-month rollover; weekly cashflow/forecast next
- Investing v1: CC → placement transfers only (not full holdings)
