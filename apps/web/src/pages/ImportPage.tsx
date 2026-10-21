import { useEffect, useState, type FormEvent } from "react";
import type { AccountWithBalance, CsvBankPreset, ImportResult } from "@pf/core";
import { api } from "../api";

const SAMPLE = `date,amount,payee,memo
2026-10-01,-54.20,Loblaws,Groceries
2026-10-02,-12.50,Tim Hortons,Coffee
2026-10-03,3200.00,Employer,Pay
`;

export function ImportPage() {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState<CsvBankPreset>("generic");
  const [csvText, setCsvText] = useState(SAMPLE);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [presetNotes, setPresetNotes] = useState<
    Record<string, { ready: boolean; note: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [a, meta] = await Promise.all([api.listAccounts(), api.meta()]);
        setAccounts(a);
        setPresetNotes(meta.csvPresets);
        if (a[0]) setAccountId(a[0].id);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  async function onFile(file: File | null) {
    if (!file) return;
    setCsvText(await file.text());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api.importCsv({ accountId, csvText, preset });
      setResult(res);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const note = presetNotes[preset];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>CSV import</h1>
          <p>
            Generic importer with duplicate detection (date + amount + payee +
            account). RBC / TD presets are stubs until verified against real
            downloads.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <form className="form-grid" onSubmit={onSubmit}>
          <div className="form-grid cols-2">
            <label>
              Target account
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
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
              Bank preset
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as CsvBankPreset)}
              >
                <option value="generic">Generic</option>
                <option value="rbc">RBC (stub)</option>
                <option value="td">TD (stub)</option>
              </select>
            </label>
          </div>

          {note && (
            <p className="note-box">
              {note.ready ? "Ready" : "Stub"} — {note.note}
            </p>
          )}

          <label>
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label>
            CSV text
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              required
            />
          </label>

          <div className="actions">
            <button type="submit" disabled={busy || !accountId || !csvText.trim()}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </form>

        {result && (
          <div style={{ marginTop: "1rem" }}>
            <p className="success">
              Imported {result.imported}; skipped {result.skippedDuplicates}{" "}
              duplicate{result.skippedDuplicates === 1 ? "" : "s"}.
            </p>
            {result.errors.length > 0 && (
              <ul className="error">
                {result.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}
