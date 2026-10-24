import { useEffect, useState } from "react";
import { api } from "../api";

export function BackupPage() {
  const [nextItems, setNextItems] = useState<string[]>([]);
  const [outOfScope, setOutOfScope] = useState<string[]>([]);
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backup &amp; export</h1>
          <p>
            Download a JSON dump or a copy of the SQLite database. Restore and
            encrypt-at-rest can follow later.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

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
          Files are served by the local API from your machine — nothing leaves
          the host unless you copy them.
        </p>
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
    </>
  );
}
