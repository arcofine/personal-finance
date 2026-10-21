import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import type { AccountWithBalance, Category, Transaction } from "@pf/core";
import { api, formatCad } from "../api";

export function RegisterPage() {
  const { accountId: routeAccountId } = useParams();
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [accountId, setAccountId] = useState(routeAccountId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // New tx
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryId, setCategoryId] = useState("");

  // Transfer
  const [toAccountId, setToAccountId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(today());
  const [transferMemo, setTransferMemo] = useState("");

  const selected = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const catName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [categories]);

  async function reload() {
    try {
      const [a, c] = await Promise.all([api.listAccounts(), api.listCategories()]);
      setAccounts(a);
      setCategories(c);
      const aid = routeAccountId || accountId || a[0]?.id || "";
      if (!accountId && aid) setAccountId(aid);
      if (aid) {
        setTxs(await api.listTransactions({ accountId: aid, q: q || undefined }));
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeAccountId]);

  useEffect(() => {
    if (!accountId) return;
    void (async () => {
      try {
        setTxs(await api.listTransactions({ accountId, q: q || undefined }));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [accountId, q]);

  async function onAddTx(e: FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    try {
      await api.createTransaction({
        accountId,
        date,
        amount: Number(amount),
        payee: payee || null,
        memo: memo || null,
        categoryId: categoryId || null,
      });
      setAmount("");
      setPayee("");
      setMemo("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onTransfer(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !toAccountId) return;
    try {
      await api.createTransfer({
        fromAccountId: accountId,
        toAccountId,
        date: transferDate,
        amount: Number(transferAmount),
        memo: transferMemo || null,
      });
      setTransferAmount("");
      setTransferMemo("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this transaction? (Transfers delete both legs.)")) return;
    try {
      await api.deleteTransaction(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const leafCategories = categories.filter((c) => c.parentId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Register</h1>
          <p>
            Manual transactions and transfers. Positive amounts increase balance;
            negative decrease. Transfers (e.g. CC → placement) create paired legs.
          </p>
        </div>
        {selected && (
          <div className={`balance ${selected.balance < 0 ? "neg" : "pos"}`}>
            {formatCad(selected.balance)}
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <div className="form-grid cols-2">
          <label>
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search payee / memo
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
            />
          </label>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>Add transaction</h2>
          <form className="form-grid" onSubmit={onAddTx}>
            <div className="form-grid cols-2">
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Amount (CAD)
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  placeholder="-42.50"
                />
              </label>
            </div>
            <label>
              Payee
              <input value={payee} onChange={(e) => setPayee(e.target.value)} />
            </label>
            <label>
              Category
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Uncategorized</option>
                {leafCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Memo
              <input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </label>
            <button type="submit" disabled={!accountId}>
              Save transaction
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Transfer between accounts</h2>
          <form className="form-grid" onSubmit={onTransfer}>
            <label>
              To account
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {accounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type})
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid cols-2">
              <label>
                Date
                <input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Amount (CAD)
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              Memo
              <input
                value={transferMemo}
                onChange={(e) => setTransferMemo(e.target.value)}
                placeholder="CC → TFSA / placement"
              />
            </label>
            <button type="submit" disabled={!accountId || !toAccountId}>
              Create transfer
            </button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Transactions</h2>
        {txs.length === 0 ? (
          <p className="empty">No transactions for this account.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.date}</td>
                  <td>
                    {tx.payee ?? "—"}
                    {tx.transferGroupId && (
                      <>
                        {" "}
                        <span className="badge">transfer</span>
                      </>
                    )}
                    {tx.memo && <div className="muted">{tx.memo}</div>}
                  </td>
                  <td>{catName(tx.categoryId)}</td>
                  <td className={`num balance ${tx.amount < 0 ? "neg" : "pos"}`}>
                    {formatCad(tx.amount)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void onDelete(tx.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
