import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Category, CategoryKind } from "@pf/core";
import { api } from "../api";

type KindTab = CategoryKind;

interface CategoryDraft {
  name: string;
  kind: CategoryKind;
  parentId: string;
}

const EMPTY: CategoryDraft = { name: "", kind: "expense", parentId: "" };

const TABS: { id: KindTab; label: string }[] = [
  { id: "expense", label: "Expenses" },
  { id: "income", label: "Income" },
  { id: "transfer", label: "Transfers" },
];

type ModalState =
  | { kind: "edit"; category: Category | null; defaultKind: CategoryKind }
  | { kind: "delete"; category: Category };

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<KindTab>("expense");
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

  const rows = useMemo(() => rowsForKind(categories, tab), [categories, tab]);

  function done() {
    setModal(null);
    setReloadToken((token) => token + 1);
  }

  return (
    <>
      <p className="settings-intro">
        A category sits under a group, such as Groceries under Food. Add a new group from{" "}
        <Link to="/settings/groups">Groups</Link>.
      </p>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <div className="tab-bar">
          <div className="tabs" role="tablist" aria-label="Category types">
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
                  {categories.filter((category) => category.kind === item.id && category.parentId).length}
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setModal({ kind: "edit", category: null, defaultKind: tab })}>
            Add category
          </button>
        </div>

        {loading && categories.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty">No categories in this list yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Group</th>
                  <th className="actions-col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.category.id}>
                    <td>
                      <div className="row-title">{row.category.name}</div>
                    </td>
                    <td>{row.groupName ?? "—"}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="secondary tiny"
                        aria-label={`Edit ${row.category.name}`}
                        onClick={() => setModal({ kind: "edit", category: row.category, defaultKind: tab })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger tiny"
                        aria-label={`Delete ${row.category.name}`}
                        onClick={() => setModal({ kind: "delete", category: row.category })}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="tab-note">Spending in a category still counts on a bill that uses it.</p>
      </section>

      {modal?.kind === "edit" && (
        <CategoryModal
          category={modal.category}
          defaultKind={modal.defaultKind}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "delete" && (
        <ConfirmModal
          title={`Delete ${modal.category.name}`}
          message={
            categories.some((category) => category.parentId === modal.category.id)
              ? `${modal.category.name} still has categories under it. Move or delete those first.`
              : `Delete ${modal.category.name}? This is only allowed when no transaction or budget record uses it.`
          }
          confirmLabel="Delete"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteCategory(modal.category.id);
            done();
          }}
        />
      )}
    </>
  );
}

function CategoryModal({
  category,
  defaultKind,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null;
  defaultKind: CategoryKind;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<CategoryDraft>(() =>
    category
      ? { name: category.name, kind: category.kind, parentId: category.parentId ?? "" }
      : { ...EMPTY, kind: defaultKind, parentId: firstGroupId(categories, defaultKind) },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = categories.filter(
    (item) => item.kind === draft.kind && item.parentId === null && item.id !== category?.id,
  );

  function set<K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!draft.parentId) {
        setError("Choose a group");
        setBusy(false);
        return;
      }
      if (category) {
        await api.updateCategory(category.id, {
          name: draft.name,
          parentId: draft.parentId,
        });
      } else {
        await api.createCategory({
          name: draft.name,
          kind: draft.kind,
          parentId: draft.parentId,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={category ? `Edit ${category.name}` : "Add category"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            required
            placeholder="Groceries"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label>
          Type
          <select
            value={draft.kind}
            disabled={category != null}
            onChange={(event) => {
              const kind = event.target.value as CategoryKind;
              setDraft((current) => ({ ...current, kind, parentId: firstGroupId(categories, kind) }));
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <label>
          Group
          <select
            value={draft.parentId}
            required
            disabled={groups.length === 0}
            onChange={(event) => set("parentId", event.target.value)}
          >
            {groups.length === 0 && <option value="">No groups yet</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted span-2 modal-hint">
          {groups.length === 0
            ? "Add a group first, then choose it here."
            : "The category appears under this group in the budget summary."}
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={category ? "Save" : "Add category"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function firstGroupId(categories: Category[], kind: CategoryKind): string {
  return (
    categories
      .filter((category) => category.kind === kind && category.parentId === null)
      .sort((a, b) => a.name.localeCompare(b.name, "en-CA"))[0]?.id ?? ""
  );
}

function rowsForKind(categories: Category[], kind: CategoryKind): { category: Category; groupName: string | null }[] {
  const matching = categories.filter((category) => category.kind === kind && category.parentId);
  const names = new Map(
    categories.filter((category) => category.parentId === null).map((category) => [category.id, category.name]),
  );
  return matching
    .map((category) => ({
      category,
      groupName: names.get(category.parentId ?? "") ?? null,
    }))
    .sort((a, b) => {
      const group = (a.groupName ?? "").localeCompare(b.groupName ?? "", "en-CA");
      if (group !== 0) return group;
      return a.category.name.localeCompare(b.category.name, "en-CA");
    });
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
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
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
          {busy ? "Deleting…" : confirmLabel}
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
