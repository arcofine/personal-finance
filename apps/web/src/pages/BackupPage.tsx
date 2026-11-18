import { useEffect, useRef, useState } from "react";
import { api, type BackupImportResult } from "../api";

export function BackupPage() {
  const [nextItems, setNextItems] = useState<string[]>([]);
  const [outOfScope, setOutOfScope] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const meta = await api.meta();
        setNextItems(meta.next);
        setOutOfScope(meta.outOfScopeM0);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  async function importFile() {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.importBackup(file);
      setNotice(importedMessage(result));
      setError(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setConfirming(false);
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backup</h1>
          <p>Download this ledger, or replace it with a JSON or SQLite backup from this app.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="panel">
        <h2>Export</h2>
        <div className="actions">
          <a className="btn" href="/api/backup/json">
            Download JSON
          </a>
          <a className="btn secondary" href="/api/backup/sqlite">
            Download SQLite (.db)
          </a>
        </div>
        <p className="note-box">
          Files are served by the local API from your machine — nothing leaves the host unless you copy them.
        </p>
      </section>

      <section className="panel">
        <h2>Import</h2>
        <p className="summary-lead">
          Importing replaces the accounts, transactions, bills, pay, and savings on this machine. A SQLite file
          includes everything. A JSON file downloaded from now on includes savings objectives too.
        </p>
        <label>
          Backup file
          <input
            id="backup-file"
            ref={fileInput}
            type="file"
            accept=".json,.db,.sqlite,.sqlite3,application/json"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setNotice(null);
              setError(null);
            }}
          />
        </label>
        <div className="actions">
          <button type="button" disabled={!file || busy} onClick={() => setConfirming(true)}>
            Import backup
          </button>
          {file && <span className="muted">{file.name}</span>}
        </div>
      </section>

      <section className="panel">
        <h2>What&apos;s next (not in M0 UI)</h2>
        <ul>
          {nextItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2 style={{ marginTop: "1.25rem" }}>Explicitly out of scope for M0</h2>
        <ul>
          {outOfScope.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {confirming && file && (
        <ConfirmImport
          name={file.name}
          busy={busy}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          onConfirm={importFile}
        />
      )}
    </>
  );
}

function ConfirmImport({
  name,
  busy,
  onClose,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
      <div className="modal" role="dialog" aria-modal="true" aria-label="Import backup">
        <div className="modal-head">
          <h2>Import backup</h2>
          <button type="button" className="secondary tiny" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p>Replace the ledger with {name}? This removes what is on this machine now.</p>
        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="danger solid" onClick={onConfirm} disabled={busy}>
            {busy ? "Importing…" : "Replace ledger"}
          </button>
        </div>
      </div>
    </div>
  );
}

function importedMessage(result: BackupImportResult): string {
  const accounts = `${result.accounts} ${result.accounts === 1 ? "account" : "accounts"}`;
  const transactions = `${result.transactions} ${result.transactions === 1 ? "transaction" : "transactions"}`;
  return `Imported ${accounts} and ${transactions}.`;
}
