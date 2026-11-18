import { useEffect, useMemo, useState } from "react";
import type { CategorySpendRow } from "@pf/core";
import { api, currentYearMonth, formatCad } from "../api";

export function CategorySpendPage() {
  const [month, setMonth] = useState(currentYearMonth());
  const [rows, setRows] = useState<CategorySpendRow[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.categorySpend(month);
        setRows(res.rows);
        setRange({ from: res.from, to: res.to });
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [month]);

  const maxAbs = useMemo(() => {
    let m = 1;
    for (const r of rows) m = Math.max(m, Math.abs(r.total));
    return m;
  }, [rows]);

  const expenseRows = rows.filter((r) => r.total < 0 || r.kind === "expense");
  const incomeRows = rows.filter((r) => r.total > 0 && r.kind === "income");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Category spend</h1>
          <p>
            Monthly totals by category (transfers excluded). Fixed expenses on the
            Budget page use these categories when you link one.
          </p>
        </div>
        <label>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {range && (
        <p className="muted">
          {range.from} → {range.to}
        </p>
      )}

      <section className="panel">
        <h2>Spending</h2>
        {expenseRows.length === 0 ? (
          <p className="empty">No categorized spending this month.</p>
        ) : (
          expenseRows.map((r) => (
            <div className="bar-row" key={r.categoryId ?? "uncat"}>
              <div>
                <strong>{r.categoryName}</strong>
                <div className="muted">{r.transactionCount} tx</div>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(Math.abs(r.total) / maxAbs) * 100}%` }}
                />
              </div>
              <div className="balance neg">{formatCad(r.total)}</div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <h2>Income</h2>
        {incomeRows.length === 0 ? (
          <p className="empty">No income categorized this month.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Total</th>
                <th className="num">Tx</th>
              </tr>
            </thead>
            <tbody>
              {incomeRows.map((r) => (
                <tr key={r.categoryId ?? "inc"}>
                  <td>{r.categoryName}</td>
                  <td className="num balance pos">{formatCad(r.total)}</td>
                  <td className="num">{r.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
