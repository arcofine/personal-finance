import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AccountType, AccountWithBalance } from "@pf/core";
import { ACCOUNT_TYPES, api, formatCad } from "../api";

interface AccountDraft {
  name: string;
  type: AccountType;
  institution: string;
  openingBalance: string;
}

type ModalState =
  | { kind: "account"; account: AccountWithBalance | null }
  | { kind: "delete"; account: AccountWithBalance };

const EMPTY_ACCOUNT: AccountDraft = {
  name: "",
  type: "checking",
  institution: "",
  openingBalance: "0",
};

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await api.listAccounts();
        if (cancelled) return;
        setAccounts(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const net = accounts.reduce((sum, account) => sum + account.balance, 0);

  function done() {
    setModal(null);
    setReloadToken((token) => token + 1);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>Checking, savings, credit, cash, and placement accounts on one household ledger.</p>
        </div>
        {accounts.length > 0 && (
          <div className="stat">
            <div className="label">Net worth</div>
            <div className={`value ${moneyClass(net)}`}>{formatCad(net)}</div>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <div className="tab-bar">
          <span className="row-title">
            {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={() => setModal({ kind: "account", account: null })}>
            Add account
          </button>
        </div>

        {loading && accounts.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : (
          <AccountTable
            accounts={accounts}
            onEdit={(account) => setModal({ kind: "account", account })}
            onDelete={(account) => setModal({ kind: "delete", account })}
          />
        )}

        <p className="tab-note">
          Balance is the opening balance plus every transaction. Placement accounts track transfers
          in, not holdings.
        </p>
      </section>

      {modal?.kind === "account" && (
        <AccountModal
          account={modal.account}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "delete" && (
        <ConfirmModal
          title="Delete account"
          message={`Delete ${modal.account.name}? It leaves this list. Transactions already recorded stay stored.`}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteAccount(modal.account.id);
            done();
          }}
        />
      )}
    </>
  );
}

function AccountTable({
  accounts,
  onEdit,
  onDelete,
}: {
  accounts: AccountWithBalance[];
  onEdit: (account: AccountWithBalance) => void;
  onDelete: (account: AccountWithBalance) => void;
}) {
  if (accounts.length === 0) {
    return <p className="empty">No accounts yet. Add a chequing account to start the ledger.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="num">Opening</th>
            <th className="num">Balance</th>
            <th className="actions-col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>
                <div className="row-title">
                  <Link to={`/register/${account.id}`}>{account.name}</Link>
                </div>
                {account.institution && <div className="row-sub">{account.institution}</div>}
              </td>
              <td>{labelFor(account.type)}</td>
              <td className={`num ${moneyClass(account.openingBalance)}`}>
                {formatCad(account.openingBalance)}
              </td>
              <td className={`num ${moneyClass(account.balance)}`}>{formatCad(account.balance)}</td>
              <td className="row-actions">
                <button
                  type="button"
                  className="secondary tiny"
                  aria-label={`Edit ${account.name}`}
                  onClick={() => onEdit(account)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger tiny"
                  aria-label={`Delete ${account.name}`}
                  onClick={() => onDelete(account)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: AccountWithBalance | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<AccountDraft>(() =>
    account
      ? {
          name: account.name,
          type: account.type,
          institution: account.institution ?? "",
          openingBalance: String(account.openingBalance),
        }
      : EMPTY_ACCOUNT,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const openingBalance = Number(draft.openingBalance);
    if (!Number.isFinite(openingBalance)) {
      setError("Opening balance must be a number");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      type: draft.type,
      institution: draft.institution.trim() || null,
      openingBalance,
      currency: "CAD" as const,
    };
    try {
      if (account) await api.updateAccount(account.id, body);
      else await api.createAccount(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? `Edit ${account.name}` : "Add account"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="RBC chequing"
            autoFocus
          />
        </label>
        <label>
          Type
          <select value={draft.type} onChange={(e) => set("type", e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Institution
          <input
            value={draft.institution}
            onChange={(e) => set("institution", e.target.value)}
            placeholder="RBC / TD"
          />
        </label>
        <label className="span-2">
          Opening balance (CAD)
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={draft.openingBalance}
            onChange={(e) => set("openingBalance", e.target.value)}
            required
          />
        </label>
        <p className="muted span-2 modal-hint">
          {account
            ? `Current balance is ${formatCad(account.balance)}. Changing the opening balance moves that total by the same amount.`
            : "Use a negative opening balance when a credit card already has a balance owing."}
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={account ? "Save" : "Add account"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="secondary tiny" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <span className="spacer" />
        <button type="button" className="secondary" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className="danger solid"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((err: Error) => {
              setError(err.message);
              setBusy(false);
            });
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}

function ModalActions({
  busy,
  label,
  onClose,
}: {
  busy: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-actions span-2">
      <span className="spacer" />
      <button type="button" className="secondary" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}

function labelFor(type: AccountType): string {
  return ACCOUNT_TYPES.find((item) => item.value === type)?.label ?? type;
}

function moneyClass(amount: number): string {
  if (amount < 0) return "balance neg";
  if (amount > 0) return "balance pos";
  return "balance";
}
