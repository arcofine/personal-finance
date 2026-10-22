import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { AccountWithBalance, Category, Transaction } from "@pf/core";
import { api, formatCad } from "../api";

type Tab = "transactions" | "transfers";

interface TxDraft {
  accountId: string;
  date: string;
  amount: string;
  payee: string;
  memo: string;
  categoryId: string;
}

interface TransferDraft {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  memo: string;
}

type ModalState =
  | { kind: "transaction"; tx: Transaction | null }
  | { kind: "transfer" }
  | { kind: "delete"; tx: Transaction };

const EMPTY_TX: TxDraft = {
  accountId: "",
  date: "",
  amount: "",
  payee: "",
  memo: "",
  categoryId: "",
};

export function RegisterPage() {
  const { accountId: routeAccountId } = useParams();
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [accountId, setAccountId] = useState(routeAccountId ?? "");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("transactions");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (routeAccountId) setAccountId(routeAccountId);
  }, [routeAccountId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [nextAccounts, nextCategories] = await Promise.all([
          api.listAccounts(),
          api.listCategories(),
        ]);
        if (cancelled) return;
        setAccounts(nextAccounts);
        setCategories(nextCategories);
        const aid = accountId || nextAccounts[0]?.id || "";
        if (!accountId && aid) setAccountId(aid);
        setTxs(aid ? await api.listTransactions({ accountId: aid, q: q || undefined }) : []);
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
  }, [accountId, q, reloadToken]);

  const selected = accounts.find((account) => account.id === accountId) ?? null;
  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    return (id: string | null) => {
      if (!id) return "Uncategorized";
      const category = byId.get(id);
      if (!category) return "—";
      const parent = category.parentId ? byId.get(category.parentId) : undefined;
      return parent ? `${parent.name} — ${category.name}` : category.name;
    };
  }, [categories]);

  const transactions = txs.filter((tx) => !tx.transferGroupId);
  const transfers = txs.filter((tx) => tx.transferGroupId);
  const visible = tab === "transactions" ? transactions : transfers;

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  function done() {
    setModal(null);
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Register</h1>
          <p>Transactions and transfers for one account. Positive amounts increase the balance.</p>
        </div>
        {selected && (
          <div className="stat">
            <div className="label">{selected.name}</div>
            <div className={`value ${moneyClass(selected.balance)}`}>{formatCad(selected.balance)}</div>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <div className="form-grid cols-2 register-filters">
          <label>
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.length === 0 && <option value="">No accounts yet</option>}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Payee or memo"
            />
          </label>
        </div>

        <div className="tab-bar">
          <div className="tabs" role="tablist" aria-label="Register sections">
            <TabButton active={tab === "transactions"} onClick={() => setTab("transactions")}>
              Transactions
              <span className="tab-count">{transactions.length}</span>
            </TabButton>
            <TabButton active={tab === "transfers"} onClick={() => setTab("transfers")}>
              Transfers
              <span className="tab-count">{transfers.length}</span>
            </TabButton>
          </div>
          <button
            type="button"
            disabled={!accountId}
            onClick={() =>
              setModal(tab === "transactions" ? { kind: "transaction", tx: null } : { kind: "transfer" })
            }
          >
            {tab === "transactions" ? "Add transaction" : "Add transfer"}
          </button>
        </div>

        {loading && txs.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : (
          <TxTable
            rows={visible}
            categoryName={categoryName}
            empty={
              tab === "transactions"
                ? "No transactions yet. Add one, or import a statement."
                : "No transfers on this account. Move money to savings or a placement account."
            }
            onEdit={(tx) => setModal({ kind: "transaction", tx })}
            onDelete={(tx) => setModal({ kind: "delete", tx })}
          />
        )}

        <p className="tab-note">
          {tab === "transactions"
            ? "An expense category is taken out of the balance, even when the amount is entered as a positive number."
            : "A transfer shows on both accounts. Deleting it removes both sides."}
        </p>
      </section>

      {modal?.kind === "transaction" && (
        <TransactionModal
          tx={modal.tx}
          accountId={accountId}
          accounts={accounts}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "transfer" && (
        <TransferModal
          accountId={accountId}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "delete" && (
        <ConfirmModal
          title={modal.tx.transferGroupId ? "Delete transfer" : "Delete transaction"}
          message={
            modal.tx.transferGroupId
              ? `Delete ${modal.tx.payee ?? "this transfer"}? Both accounts lose the paired entry.`
              : `Delete ${modal.tx.payee ?? "this transaction"}?`
          }
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteTransaction(modal.tx.id);
            done();
          }}
        />
      )}
    </>
  );
}

function TxTable({
  rows,
  categoryName,
  empty,
  onEdit,
  onDelete,
}: {
  rows: Transaction[];
  categoryName: (id: string | null) => string;
  empty: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  const total = rows.reduce((sum, tx) => sum + tx.amount, 0);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payee</th>
            <th>Category</th>
            <th className="num">Amount</th>
            <th className="actions-col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => {
            const label = tx.payee || (tx.transferGroupId ? "Transfer" : "—");
            return (
              <tr key={tx.id}>
                <td>{formatDate(tx.date)}</td>
                <td>
                  <div className="row-title">{label}</div>
                  {tx.memo && <div className="row-sub">{tx.memo}</div>}
                </td>
                <td>{tx.transferGroupId ? "Transfer" : categoryName(tx.categoryId)}</td>
                <td className={`num ${moneyClass(tx.amount)}`}>{formatCad(tx.amount)}</td>
                <td className="row-actions">
                  {!tx.transferGroupId && (
                    <button
                      type="button"
                      className="secondary tiny"
                      aria-label={`Edit ${label}`}
                      onClick={() => onEdit(tx)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger tiny"
                    aria-label={`Delete ${label}`}
                    onClick={() => onDelete(tx)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className={`num ${moneyClass(total)}`}>{formatCad(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TransactionModal({
  tx,
  accountId,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  tx: Transaction | null;
  accountId: string;
  accounts: AccountWithBalance[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<TxDraft>(() =>
    tx
      ? {
          accountId: tx.accountId,
          date: tx.date,
          amount: String(tx.amount),
          payee: tx.payee ?? "",
          memo: tx.memo ?? "",
          categoryId: tx.categoryId ?? "",
        }
      : { ...EMPTY_TX, accountId, date: today() },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = categoryOptions(categories);
  const selectedKind = categories.find((category) => category.id === draft.categoryId)?.kind ?? null;

  function set<K extends keyof TxDraft>(key: K, value: TxDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      accountId: draft.accountId,
      date: draft.date,
      amount: Number(draft.amount),
      payee: draft.payee || null,
      memo: draft.memo || null,
      categoryId: draft.categoryId || null,
    };
    try {
      if (tx) await api.updateTransaction(tx.id, body);
      else await api.createTransaction(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={tx ? `Edit ${tx.payee || "transaction"}` : "Add transaction"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Account
          <select value={draft.accountId} onChange={(e) => set("accountId", e.target.value)} required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} required />
        </label>
        <label>
          Amount (CAD)
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
            required
            placeholder={selectedKind === "expense" ? "42.50" : "-42.50"}
            autoFocus
          />
        </label>
        <label className="span-2">
          Payee
          <input value={draft.payee} onChange={(e) => set("payee", e.target.value)} />
        </label>
        <label className="span-2">
          Category
          <select value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Uncategorized</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Memo
          <input value={draft.memo} onChange={(e) => set("memo", e.target.value)} />
        </label>
        <p className="muted span-2 modal-hint">
          {selectedKind === "expense"
            ? "This amount is taken out of the account. 42.50 and -42.50 both reduce the balance."
            : "Positive amounts increase the balance. Choose an expense category to take the amount out automatically."}
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={tx ? "Save" : "Add transaction"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function TransferModal({
  accountId,
  accounts,
  onClose,
  onSaved,
}: {
  accountId: string;
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<TransferDraft>({
    fromAccountId: accountId,
    toAccountId: "",
    date: today(),
    amount: "",
    memo: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof TransferDraft>(key: K, value: TransferDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTransfer({
        fromAccountId: draft.fromAccountId,
        toAccountId: draft.toAccountId,
        date: draft.date,
        amount: Number(draft.amount),
        memo: draft.memo || null,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Add transfer" onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label>
          From
          <select
            value={draft.fromAccountId}
            onChange={(e) => set("fromAccountId", e.target.value)}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={draft.toAccountId} onChange={(e) => set("toAccountId", e.target.value)} required>
            <option value="">Select…</option>
            {accounts
              .filter((account) => account.id !== draft.fromAccountId)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} required />
        </label>
        <label>
          Amount (CAD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
            required
            placeholder="200"
            autoFocus
          />
        </label>
        <label className="span-2">
          Memo
          <input
            value={draft.memo}
            onChange={(e) => set("memo", e.target.value)}
            placeholder="Chequing to savings"
          />
        </label>
        <p className="muted span-2 modal-hint">
          Money leaves the first account and arrives in the second. The amount is always positive.
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label="Add transfer" onClose={onClose} />
      </form>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "tab active" : "tab"}
      onClick={onClick}
    >
      {children}
    </button>
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

function categoryOptions(categories: Category[]): { id: string; label: string }[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories
    .filter((category) => category.parentId)
    .map((category) => {
      const parent = category.parentId ? byId.get(category.parentId) : undefined;
      const name = parent ? `${parent.name} — ${category.name}` : category.name;
      return { id: category.id, label: `${name} (${category.kind})` };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "en-CA"));
}

function moneyClass(amount: number): string {
  if (amount < 0) return "balance neg";
  if (amount > 0) return "balance pos";
  return "balance";
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDate(iso: string): string {
  const [yearText, monthText, dayText] = iso.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
