import type {
  AccountType,
  AccountWithBalance,
  Category,
  CategorySpendRow,
  CreateAccountInput,
  CreateTransactionInput,
  CreateTransferInput,
  CsvBankPreset,
  ImportResult,
  Transaction,
  UpdateAccountInput,
  UpdateTransactionInput,
} from "@pf/core";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  meta: () =>
    request<{
      currency: string;
      csvPresets: Record<string, { ready: boolean; note: string }>;
      next: string[];
      outOfScopeM0: string[];
    }>("/api/meta"),

  listAccounts: () => request<AccountWithBalance[]>("/api/accounts"),
  createAccount: (input: CreateAccountInput) =>
    request<AccountWithBalance>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAccount: (id: string, input: UpdateAccountInput) =>
    request<AccountWithBalance>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteAccount: (id: string) =>
    request<void>(`/api/accounts/${id}`, { method: "DELETE" }),

  listCategories: () => request<Category[]>("/api/categories"),

  listTransactions: (params: {
    accountId?: string;
    from?: string;
    to?: string;
    q?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.accountId) qs.set("accountId", params.accountId);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.q) qs.set("q", params.q);
    const q = qs.toString();
    return request<Transaction[]>(`/api/transactions${q ? `?${q}` : ""}`);
  },
  createTransaction: (input: CreateTransactionInput) =>
    request<Transaction>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTransaction: (id: string, input: UpdateTransactionInput) =>
    request<Transaction>(`/api/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteTransaction: (id: string) =>
    request<void>(`/api/transactions/${id}`, { method: "DELETE" }),

  createTransfer: (input: CreateTransferInput) =>
    request<{ transferGroupId: string; legs: Transaction[] }>("/api/transfers", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  importCsv: (input: {
    accountId: string;
    csvText: string;
    preset?: CsvBankPreset;
  }) =>
    request<ImportResult>("/api/import/csv", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  categorySpend: (month: string) =>
    request<{
      yearMonth: string;
      from: string;
      to: string;
      rows: CategorySpendRow[];
    }>(`/api/reports/category-spend?month=${encodeURIComponent(month)}`),
};

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking / Chequing (CC)" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "cash", label: "Cash" },
  { value: "placement", label: "Placement / Investment" },
];

export function formatCad(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}

export function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
