import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AccountType, AccountWithBalance } from "@pf/core";
import { ACCOUNT_TYPES, api, formatCad } from "../api";

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setAccounts(await api.listAccounts());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createAccount({
        name,
        type,
        institution: institution || null,
        openingBalance: Number(openingBalance) || 0,
        currency: "CAD",
      });
      setName("");
      setInstitution("");
      setOpeningBalance("0");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Soft-delete this account?")) return;
    try {
      await api.deleteAccount(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>
            Shared household ledger in CAD. Checking/chequing (CC), savings, credit,
            cash, and placement accounts.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="grid-2">
        <section className="panel">
          <h2>Household accounts</h2>
          {accounts.length === 0 ? (
            <p className="empty">No accounts yet — add one to start the ledger.</p>
          ) : (
            <div className="account-list">
              {accounts.map((a) => (
                <Link key={a.id} to={`/register/${a.id}`} className="account-row">
                  <div>
                    <strong>{a.name}</strong>
                    <div className="meta">
                      {labelFor(a.type)}
                      {a.institution ? ` · ${a.institution}` : ""} · {a.currency}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <span className={`balance ${a.balance < 0 ? "neg" : "pos"}`}>
                      {formatCad(a.balance)}
                    </span>
                    <button
                      type="button"
                      className="danger"
                      onClick={(ev) => {
                        ev.preventDefault();
                        void onDelete(a.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Add account</h2>
          <form className="form-grid" onSubmit={onCreate}>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="RBC chequing"
              />
            </label>
            <label>
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Institution (optional)
              <input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="RBC / TD"
              />
            </label>
            <label>
              Opening balance (CAD)
              <input
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy || !name.trim()}>
                Create account
              </button>
            </div>
          </form>
          <p className="note-box">
            Placement accounts track balances and inbound transfers from CC — not
            holdings or lots (v1).
          </p>
        </section>
      </div>
    </>
  );
}

function labelFor(type: AccountType): string {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
}
