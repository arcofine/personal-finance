import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Category, CategoryKind } from "@pf/core";
import { api } from "../api";

const TABS: { id: CategoryKind; label: string }[] = [
  { id: "expense", label: "Expenses" },
  { id: "income", label: "Income" },
  { id: "transfer", label: "Transfers" },
];

type ModalState =
  | { kind: "edit"; group: Category | null; defaultKind: CategoryKind }
  | { kind: "delete"; group: Category };

export function GroupsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<CategoryKind>("expense");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await api.listCategories();
        if (cancelled) return;
        setCategories(next);
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

  const groups = useMemo(
    () =>
      categories
        .filter((category) => category.kind === tab && category.parentId === null)
        .sort((a, b) => a.name.localeCompare(b.name, "en-CA")),
    [categories, tab],
  );

  function done() {
    setModal(null);
    setReloadToken((token) => token + 1);
  }

  return (
    <>
      <p className="settings-intro">
        A group gathers categories, such as Food or Housing. The name you choose here is the name shown on the budget
        summary.
      </p>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <div className="tab-bar">
          <div className="tabs" role="tablist" aria-label="Group types">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className={tab === item.id ? "tab active" : "tab"}
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <span className="tab-count">
                  {categories.filter((category) => category.kind === item.id && category.parentId === null).length}
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setModal({ kind: "edit", group: null, defaultKind: tab })}>
            Add group
          </button>
        </div>

        {loading && categories.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="empty">No groups in this list yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Categories</th>
                  <th className="actions-col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const count = categories.filter((category) => category.parentId === group.id).length;
                  return (
                    <tr key={group.id}>
                      <td>
                        <div className="row-title">{group.name}</div>
                      </td>
                      <td className="num">{count}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="secondary tiny"
                          aria-label={`Edit ${group.name}`}
                          onClick={() => setModal({ kind: "edit", group, defaultKind: tab })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger tiny"
                          aria-label={`Delete ${group.name}`}
                          onClick={() => setModal({ kind: "delete", group })}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="tab-note">
          Add the categories that belong in a group from{" "}
          <Link to="/settings/categories">Categories</Link>.
        </p>
      </section>

      {modal?.kind === "edit" && (
        <GroupModal
          group={modal.group}
          defaultKind={modal.defaultKind}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "delete" && (
        <ConfirmModal
          title={`Delete ${modal.group.name}`}
          message={`Delete ${modal.group.name}? A group with categories under it has to be emptied first, and a group used on a transaction or bill stays.`}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteCategory(modal.group.id);
            done();
          }}
        />
      )}
    </>
  );
}

function GroupModal({
  group,
  defaultKind,
  onClose,
  onSaved,
}: {
  group: Category | null;
  defaultKind: CategoryKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(group?.kind ?? defaultKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (group) {
        await api.updateCategory(group.id, { name, parentId: null });
      } else {
        await api.createCategory({ name, kind, parentId: null });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={group ? `Edit ${group.name}` : "Add group"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Food"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className="span-2">
          Type
          <select value={kind} disabled={group != null} onChange={(event) => setKind(event.target.value as CategoryKind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <p className="muted span-2 modal-hint">
          Categories you add later sit under this group. The type stays as it is created.
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={group ? "Save" : "Add group"} onClose={onClose} />
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
        <button type="button" className="secondary" onClick={onClose}>
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

function ModalActions({ busy, label, onClose }: { busy: boolean; label: string; onClose: () => void }) {
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
