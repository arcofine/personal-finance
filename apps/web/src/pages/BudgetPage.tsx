import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  AccountWithBalance,
  BudgetMonth,
  BudgetPerformance,
  BudgetMonthRow,
  Category,
  PayFrequency,
  SalaryMonthRow,
  SavingsFrequency,
  SavingsMonthRow,
  Transaction,
  Weekday,
} from "@pf/core";
import {
  buildBudgetPerformance,
  buildMonthSummary,
  buildWeekFunds,
  dateOnDay,
  monthBounds,
  round2,
  shiftYearMonth,
  WEEKDAYS,
  weekdayName,
  weekdayOf,
} from "@pf/core";
import { MonthSummaryView } from "./MonthSummaryView";
import { localToday } from "./WeekFunds";
import { api, currentYearMonth, formatCad } from "../api";

type Tab = "summary" | "performance" | "income" | "expenses" | "savings";

type SavingsDirection = "in" | "out";

interface SavingsMove {
  id: string;
  date: string;
  amount: number;
  memo: string | null;
  fromName: string;
  toName: string;
  direction: SavingsDirection | "between";
  potLabel: string;
  /** True when both accounts have a paired transfer leg. */
  paired: boolean;
}

interface ExpenseDraft {
  name: string;
  amount: string;
  frequency: PayFrequency;
  weekday: Weekday;
  anchorDate: string;
  dueDate: string;
  categoryId: string;
  accountId: string;
  carryIn: string;
  months: { yearMonth: string; amount: string }[];
}

interface SalaryDraft {
  name: string;
  amount: string;
  anchorDate: string;
  categoryId: string;
  accountId: string;
  rates: { effectiveOn: string; amount: string }[];
}

type ModalState =
  | { kind: "expense"; row: BudgetMonthRow | null }
  | { kind: "salary"; row: SalaryMonthRow | null }
  | { kind: "paid"; row: BudgetMonthRow }
  | { kind: "delete-expense"; row: BudgetMonthRow }
  | { kind: "delete-salary"; row: SalaryMonthRow }
  | { kind: "savings" }
  | { kind: "delete-savings"; move: SavingsMove }
  | { kind: "savings-plan"; row: SavingsMonthRow | null }
  | { kind: "delete-savings-plan"; row: SavingsMonthRow };

const EMPTY_EXPENSE: ExpenseDraft = {
  name: "",
  amount: "",
  frequency: "monthly",
  weekday: "friday",
  anchorDate: "",
  dueDate: "",
  categoryId: "",
  accountId: "",
  carryIn: "",
  months: [],
};

const EMPTY_SALARY: SalaryDraft = {
  name: "",
  amount: "",
  anchorDate: "",
  categoryId: "",
  accountId: "",
  rates: [],
};

export function BudgetPage() {
  const [month, setMonth] = useState(currentYearMonth());
  const [budget, setBudget] = useState<BudgetMonth | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [transfers, setTransfers] = useState<Transaction[]>([]);
  const [transferMonth, setTransferMonth] = useState("");
  const [savingsReport, setSavingsReport] = useState<{
    yearMonth: string;
    rows: SavingsMonthRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<Tab>("summary");
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const bounds = monthBounds(month);
        const [nextBudget, nextCategories, nextAccounts, nextTransfers, nextSavings] =
          await Promise.all([
            api.budgetMonth(month),
            api.listCategories(),
            api.listAccounts(),
            api.listTransactions({ to: bounds.to }),
            api.savingsMonth(month),
          ]);
        if (cancelled) return;
        setBudget(nextBudget);
        setCategories(nextCategories);
        setAccounts(nextAccounts);
        setTransfers(nextTransfers);
        setTransferMonth(month);
        setSavingsReport(nextSavings);
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
  }, [month, reloadToken]);

  const visible = budget?.yearMonth === month ? budget : null;
  const monthTransactions = useMemo(() => {
    const bounds = monthBounds(month);
    return transfers.filter((tx) => tx.date >= bounds.from && tx.date <= bounds.to);
  }, [transfers, month]);
  const savingsMoves = useMemo(
    () => (transferMonth === month ? savingsTransfers(monthTransactions, accounts) : []),
    [transferMonth, month, monthTransactions, accounts],
  );
  const savingsPlans = savingsReport?.yearMonth === month ? savingsReport.rows : [];
  const performance = useMemo(
    () =>
      visible
        ? buildBudgetPerformance(visible, monthTransactions, categories, savingsPlans)
        : null,
    [visible, monthTransactions, categories, savingsPlans],
  );
  const summary = useMemo(() => {
    if (!visible) return null;
    return buildMonthSummary({
      yearMonth: month,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        openingBalance: account.openingBalance,
      })),
      movements: transfers.map((tx) => ({
        accountId: tx.accountId,
        date: tx.date,
        amount: tx.amount,
        categoryId: tx.categoryId,
        transfer: tx.transferGroupId != null,
      })),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parentId,
        kind: category.kind,
      })),
      plans: [
        ...visible.income.map((row) => ({
          categoryId: row.categoryId,
          kind: "income" as const,
          dates: row.dates.map((date, index) => ({
            date,
            amount: row.payAmounts[index] ?? 0,
          })),
          unscheduled: row.dates.length === 0 ? row.expected : 0,
        })),
        ...visible.rows.map((row) => ({
          categoryId: row.categoryId,
          kind: "expense" as const,
          dates: splitPlanned(row.planned, row.dates),
          unscheduled: row.dates.length === 0 ? row.planned : 0,
        })),
      ],
    });
  }, [visible, month, accounts, transfers, categories]);
  const weekFunds = useMemo(() => {
    if (!visible) return [];
    return buildWeekFunds({
      fromMonth: month,
      toMonth: month,
      accounts: accounts.map((account) => ({
        id: account.id,
        type: account.type,
        openingBalance: account.openingBalance,
      })),
      movements: transfers.map((tx) => ({
        accountId: tx.accountId,
        date: tx.date,
        amount: tx.amount,
        categoryId: tx.categoryId,
        payee: tx.payee,
        transferGroupId: tx.transferGroupId,
      })),
      plans: [
        ...visible.income.map((row) => ({
          name: row.name,
          kind: "income" as const,
          accountId: row.accountId,
          categoryId: row.categoryId,
          dates: row.dates.map((date, index) => ({ date, amount: row.payAmounts[index] ?? 0 })),
          recorded: row.received,
        })),
        ...visible.rows.map((row) => ({
          name: row.name,
          kind: "expense" as const,
          accountId: row.accountId,
          categoryId: row.categoryId,
          dates: splitPlanned(row.planned, row.dates),
          recorded: row.spent,
        })),
      ],
      savings: savingsPlans.map((row) => ({
        toAccountId: row.toAccountId,
        amount: row.amount,
        frequency: row.frequency,
        weekday: row.weekday,
        startsOn: row.startsOn,
        monthAmounts: row.monthAmounts,
        intervals: row.intervals ?? [],
      })),
    });
  }, [visible, month, accounts, transfers, savingsPlans]);
  const pots = accounts.filter((account) => isPot(account.type));
  const plannedSavings = round2(savingsPlans.reduce((sum, row) => sum + row.planned, 0));
  const setAside = savingsMoves
    .filter((move) => move.direction === "in")
    .reduce((sum, move) => sum + move.amount, 0);
  const withdrawn = savingsMoves
    .filter((move) => move.direction === "out")
    .reduce((sum, move) => sum + move.amount, 0);

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  function done(nextMonth?: string) {
    setModal(null);
    if (nextMonth && nextMonth !== month) setMonth(nextMonth);
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p>Paychecks, fixed expenses, and money set aside, month by month.</p>
        </div>
        <div className="month-nav">
          <button
            type="button"
            className="secondary"
            onClick={() => setMonth((current) => shiftYearMonth(current, -1))}
          >
            Previous
          </button>
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => setMonth((current) => shiftYearMonth(current, 1))}
          >
            Next
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {visible && (
        <div className="stat-row">
          <Stat label="Income" amount={visible.incomeTotal} />
          <Stat label="Planned expenses" amount={visible.totals.planned} />
          <Stat label="Paid" amount={visible.totals.spent} />
          <Stat
            label="Income after plan"
            amount={round2(visible.incomeTotal - visible.totals.planned - plannedSavings)}
            signed
            note="After expenses and money set aside"
          />
        </div>
      )}

      <section className="panel">
        <div className="tab-bar">
          <div className="tabs" role="tablist" aria-label="Budget sections">
            <TabButton active={tab === "summary"} onClick={() => setTab("summary")}>
              Summary
            </TabButton>
            <TabButton active={tab === "performance"} onClick={() => setTab("performance")}>
              Performance
            </TabButton>
            <TabButton active={tab === "income"} onClick={() => setTab("income")}>
              Income
              <span className="tab-count">{visible?.income.length ?? 0}</span>
            </TabButton>
            <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")}>
              Expenses
              <span className="tab-count">{visible?.rows.length ?? 0}</span>
            </TabButton>
            <TabButton active={tab === "savings"} onClick={() => setTab("savings")}>
              Savings
              <span className="tab-count">{savingsPlans.length}</span>
            </TabButton>
          </div>
          {tab === "performance" || tab === "summary" ? null : tab === "savings" ? (
            <div className="tab-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal({ kind: "savings-plan", row: null })}
              >
                Add objective
              </button>
              <button type="button" onClick={() => setModal({ kind: "savings" })}>
                Add transfer
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setModal(
                  tab === "income" ? { kind: "salary", row: null } : { kind: "expense", row: null },
                )
              }
            >
              {tab === "income" ? "Add salary" : "Add expense"}
            </button>
          )}
        </div>

        {loading && !visible ? (
          <p className="empty">Loading…</p>
        ) : !visible ? null : tab === "summary" && summary ? (
          <MonthSummaryView
            summary={summary}
            funds={weekFunds}
            today={localToday()}
            previousMonth={formatYearMonth(shiftYearMonth(month, -1))}
          />
        ) : tab === "performance" && performance ? (
          <PerformanceView report={performance} />
        ) : tab === "income" ? (
          <IncomeTable
            rows={visible.income}
            total={visible.incomeTotal}
            onEdit={(row) => setModal({ kind: "salary", row })}
            onDelete={(row) => setModal({ kind: "delete-salary", row })}
          />
        ) : tab === "expenses" ? (
          <ExpenseTable
            month={visible}
            onPaid={(row) => setModal({ kind: "paid", row })}
            onEdit={(row) => setModal({ kind: "expense", row })}
            onDelete={(row) => setModal({ kind: "delete-expense", row })}
          />
        ) : (
          <>
            <SavingsPlans
              rows={savingsPlans}
              onEdit={(row) => setModal({ kind: "savings-plan", row })}
              onDelete={(row) => setModal({ kind: "delete-savings-plan", row })}
            />
            <h3 className="section-label">Recorded</h3>
            <SavingsTable
              pots={pots}
              moves={savingsMoves}
              setAside={setAside}
              withdrawn={withdrawn}
              onDelete={(move) => setModal({ kind: "delete-savings", move })}
            />
          </>
        )}

        <p className="tab-note">
          {tab === "income"
            ? "Each salary repeats every 14 days from the payday you pick — 26 paychecks a year. Pick paydays a week apart when you alternate."
            : tab === "expenses"
              ? "Left is planned minus paid for this month. A positive amount is under the plan, and a negative amount is over. Nothing moves to the next month. Link a category so spending counts as paid automatically."
              : tab === "savings"
                ? "An objective repeats weekly or monthly. Money you record in that account counts toward it, and money leaving it sets it back. What is still to save carries into the next month."
                : tab === "performance"
                  ? "Realized means activity recorded in the register. Expense performance covers the recurring items in this budget; categorized income and money recorded in savings or placement feed the other comparisons."
                  : "The week cards use chequing and cash. A bill already paid is not counted again. Opening balances below are the previous month’s closing balances."}
        </p>
      </section>

      {modal?.kind === "expense" && (
        <ExpenseModal
          row={modal.row}
          month={month}
          categories={categories}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal?.kind === "salary" && (
        <SalaryModal
          row={modal.row}
          month={month}
          categories={categories}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => done()}
        />
      )}
      {modal?.kind === "paid" && (
        <PaidModal
          row={modal.row}
          month={month}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => done()}
        />
      )}
      {modal?.kind === "delete-expense" && (
        <RemoveExpenseModal
          row={modal.row}
          month={month}
          onClose={() => setModal(null)}
          onRemoved={() => done()}
        />
      )}
      {modal?.kind === "delete-salary" && (
        <ConfirmModal
          title="Delete salary"
          message={`Delete ${modal.row.name}?`}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteSalary(modal.row.id);
            done();
          }}
        />
      )}
      {modal?.kind === "savings" && (
        <SavingsModal
          month={month}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => done()}
        />
      )}
      {modal?.kind === "delete-savings" && (
        <ConfirmModal
          title={modal.move.paired ? "Delete transfer" : "Delete transaction"}
          message={
            modal.move.paired
              ? `Delete the ${formatCad(modal.move.amount)} transfer from ${modal.move.fromName} to ${modal.move.toName}? Both accounts lose the paired entry.`
              : `Delete the ${formatCad(modal.move.amount)} entry on ${modal.move.direction === "out" ? modal.move.fromName : modal.move.toName}?`
          }
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.deleteTransaction(modal.move.id);
            done();
          }}
        />
      )}
      {modal?.kind === "savings-plan" && (
        <SavingsPlanModal
          row={modal.row}
          month={month}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => done()}
        />
      )}
      {modal?.kind === "delete-savings-plan" && (
        <RemoveObjectiveModal
          name={modal.row.name}
          month={month}
          onClose={() => setModal(null)}
          onRemoved={async (scope) => {
            await api.deleteSavingsPlan(modal.row.id, month, scope);
            done();
          }}
        />
      )}
    </>
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

function PerformanceView({ report }: { report: BudgetPerformance }) {
  return (
    <div className="performance-report">
      <div className="stat-row performance-stats">
        <PerformanceStat
          label="Income realized"
          comparison={report.income}
          favourableLabel="Above plan"
          unfavourableLabel="Below plan"
        />
        <PerformanceStat
          label="Expenses realized"
          comparison={report.expenses}
          favourableLabel="Under budget"
          unfavourableLabel="Over budget"
        />
        <PerformanceStat
          label="Savings realized"
          comparison={report.savings}
          favourableLabel="Ahead of target"
          unfavourableLabel="Below target"
        />
      </div>

      <PerformanceTable
        title="Expense performance"
        empty="No budgeted expenses this month."
        rows={report.expenses.rows}
        expense
      />
      <PerformanceTable
        title="Savings performance"
        empty="No savings objectives this month."
        rows={report.savings.rows}
      />
    </div>
  );
}

function PerformanceStat({
  label,
  comparison,
  favourableLabel,
  unfavourableLabel,
}: {
  label: string;
  comparison: { budgeted: number; realized: number; variance: number; percent: number | null };
  favourableLabel: string;
  unfavourableLabel: string;
}) {
  const even = Math.abs(comparison.variance) < 0.005;
  const favourable = comparison.variance > 0;
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{formatCad(comparison.realized)}</div>
      <div className="performance-stat-detail">
        of {formatCad(comparison.budgeted)}
        <span className={even ? "muted" : favourable ? "balance pos" : "balance neg"}>
          {even
            ? "On plan"
            : `${favourable ? favourableLabel : unfavourableLabel} by ${formatCad(
                Math.abs(comparison.variance),
              )}`}
        </span>
      </div>
    </div>
  );
}

function PerformanceTable({
  title,
  empty,
  rows,
  expense = false,
}: {
  title: string;
  empty: string;
  rows: BudgetPerformance["expenses"]["rows"];
  expense?: boolean;
}) {
  return (
    <>
      <h3 className="section-label">{title}</h3>
      {rows.length === 0 ? (
        <p className="empty performance-empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table performance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Comparison</th>
                <th className="num">Budgeted</th>
                <th className="num">Realized</th>
                <th className="num">Variance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row-title">{row.name}</div>
                  </td>
                  <td>
                    <ComparisonBars budgeted={row.budgeted} realized={row.realized} />
                  </td>
                  <td className="num">{formatCad(row.budgeted)}</td>
                  <td className="num">{formatCad(row.realized)}</td>
                  <td className={`num ${moneyClass(row.variance)}`}>
                    {formatSignedCad(row.variance)}
                  </td>
                  <td>
                    <span className={`performance-status ${row.status}`}>
                      {performanceLabel(row.status, expense)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ComparisonBars({ budgeted, realized }: { budgeted: number; realized: number }) {
  const max = Math.max(Math.abs(budgeted), Math.abs(realized), 1);
  return (
    <div className="comparison-bars" aria-label={`Budgeted ${formatCad(budgeted)}, realized ${formatCad(realized)}`}>
      <span className="comparison-bar budgeted" style={{ width: `${(Math.abs(budgeted) / max) * 100}%` }} />
      <span className="comparison-bar realized" style={{ width: `${(Math.abs(realized) / max) * 100}%` }} />
    </div>
  );
}

function performanceLabel(
  status: BudgetPerformance["expenses"]["rows"][number]["status"],
  expense: boolean,
): string {
  if (status === "on-track") return "On plan";
  if (status === "not-budgeted") return "No target";
  if (expense) return status === "ahead" ? "Under budget" : "Over budget";
  return status === "ahead" ? "Ahead" : "Below target";
}

function IncomeTable({
  rows,
  total,
  onEdit,
  onDelete,
}: {
  rows: SalaryMonthRow[];
  total: number;
  onEdit: (row: SalaryMonthRow) => void;
  onDelete: (row: SalaryMonthRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="empty">No salary yet. Add one paycheck for each of you.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Payday</th>
            <th>This month</th>
            <th className="num">Per paycheck</th>
            <th className="num">Expected</th>
            <th className="num">Received</th>
            <th className="actions-col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="row-title">{row.name}</div>
                <div className="row-sub">{detailLine(row.categoryName, row.accountName)}</div>
              </td>
              <td>
                {row.anchorDate ? `${weekdayName(weekdayOf(row.anchorDate))}s` : "—"}
                <div className="row-sub">Every 2 weeks</div>
              </td>
              <td>
                {row.occurrences} paycheck{row.occurrences === 1 ? "" : "s"}
                <div className="row-sub">{formatPaydayList(row.dates) || "—"}</div>
              </td>
              <td className="num">{formatPayAmounts(row.payAmounts)}</td>
              <td className="num">
                <span className="balance pos">{formatCad(row.expected)}</span>
              </td>
              <td className="num">
                {row.receivedSource === "category" ? (
                  formatCad(row.received)
                ) : (
                  <span
                    className="muted"
                    title={
                      row.receivedSource === "shared"
                        ? "Deposits in this category are not split between paychecks"
                        : "Link an income category to track deposits"
                    }
                  >
                    —
                  </span>
                )}
              </td>
              <td className="row-actions">
                <button
                  type="button"
                  className="secondary tiny"
                  aria-label={`Edit ${row.name}`}
                  onClick={() => onEdit(row)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger tiny"
                  aria-label={`Delete ${row.name}`}
                  onClick={() => onDelete(row)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>Total</td>
            <td className="num">
              <span className="balance pos">{formatCad(total)}</span>
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ExpenseTable({
  month,
  onPaid,
  onEdit,
  onDelete,
}: {
  month: BudgetMonth;
  onPaid: (row: BudgetMonthRow) => void;
  onEdit: (row: BudgetMonthRow) => void;
  onDelete: (row: BudgetMonthRow) => void;
}) {
  if (month.rows.length === 0) {
    return (
      <p className="empty">
        No expenses in {formatYearMonth(month.yearMonth)}. Add rent, insurance, phone — anything
        that repeats.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Schedule</th>
            <th className="num">Brought forward</th>
            <th className="num">Planned</th>
            <th className="num">Paid</th>
            <th className="num">Left</th>
            <th className="actions-col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {month.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="row-title">{row.name}</div>
                <div className="row-sub">{detailLine(row.categoryName, row.accountName)}</div>
              </td>
              <td>
                {scheduleLabel(row)}
                {row.dates.length > 0 && (
                  <div className="row-sub">{formatPaydayList(row.dates)}</div>
                )}
              </td>
              <td className="num">
                <span className={moneyClass(row.broughtForward)}>
                  {formatCad(row.broughtForward)}
                </span>
              </td>
              <td className="num">
                {formatCad(row.planned)}
                {row.plannedOverridden ? (
                  <div className="row-sub">This month only</div>
                ) : (
                  row.frequency !== "monthly" && (
                    <div className="row-sub">
                      {formatCad(row.monthlyAmount)} × {row.occurrences}
                    </div>
                  )
                )}
              </td>
              <td className="num">
                {formatCad(row.spent)}
                <div className="row-sub">{paidSourceLabel(row)}</div>
              </td>
              <td className="num">
                <strong className={moneyClass(row.left)}>{formatCad(row.left)}</strong>
              </td>
              <td className="row-actions">
                <button
                  type="button"
                  className="secondary tiny"
                  aria-label={`Record paid for ${row.name}`}
                  onClick={() => onPaid(row)}
                >
                  Paid
                </button>
                <button
                  type="button"
                  className="secondary tiny"
                  aria-label={`Edit ${row.name}`}
                  onClick={() => onEdit(row)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger tiny"
                  aria-label={`Delete ${row.name}`}
                  onClick={() => onDelete(row)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="num">
              <span className={moneyClass(month.totals.broughtForward)}>
                {formatCad(month.totals.broughtForward)}
              </span>
            </td>
            <td className="num">{formatCad(month.totals.planned)}</td>
            <td className="num">{formatCad(month.totals.spent)}</td>
            <td className="num">
              <strong className={moneyClass(month.totals.left)}>
                {formatCad(month.totals.left)}
              </strong>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
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

function MonthAmountList({
  rows,
  defaultMonth,
  onChange,
  amountLabel = "Planned total (CAD)",
}: {
  rows: { yearMonth: string; amount: string }[];
  defaultMonth: string;
  onChange: (rows: { yearMonth: string; amount: string }[]) => void;
  amountLabel?: string;
}) {
  return (
    <div className="span-2 salary-changes">
      <div className="salary-changes-head">
        <span>Only these months</span>
        <button
          type="button"
          className="secondary tiny"
          onClick={() => onChange([...rows, { yearMonth: defaultMonth, amount: "" }])}
        >
          Add a month
        </button>
      </div>
      {rows.map((item, index) => (
        <div className="salary-change" key={`${item.yearMonth}-${index}`}>
          <label>
            Month
            <input
              type="month"
              value={item.yearMonth}
              required
              onChange={(event) =>
                onChange(rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, yearMonth: event.target.value } : row,
                ))
              }
            />
          </label>
          <label>
            {amountLabel}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={item.amount}
              required
              onChange={(event) =>
                onChange(rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, amount: event.target.value } : row,
                ))
              }
            />
          </label>
          <button
            type="button"
            className="danger tiny"
            onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function DateIntervalList({
  month,
  rows,
  onChange,
  amountLabel,
}: {
  month: string;
  rows: { from: string; to: string; amount: string }[];
  onChange: (rows: { from: string; to: string; amount: string }[]) => void;
  amountLabel: string;
}) {
  const bounds = monthBounds(month);
  return (
    <div className="span-2 salary-changes">
      <div className="salary-changes-head">
        <span>These dates</span>
        <button
          type="button"
          className="secondary tiny"
          onClick={() => onChange([...rows, { from: bounds.from, to: bounds.to, amount: "" }])}
        >
          Add dates
        </button>
      </div>
      {rows.map((item, index) => (
        <div className="salary-change date-interval" key={`${item.from}-${item.to}-${index}`}>
          <label>
            From
            <input
              type="date"
              value={item.from}
              required
              onChange={(event) =>
                onChange(rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, from: event.target.value } : row,
                ))
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={item.to}
              required
              onChange={(event) =>
                onChange(rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, to: event.target.value } : row,
                ))
              }
            />
          </label>
          <label>
            {amountLabel}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={item.amount}
              required
              onChange={(event) =>
                onChange(rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, amount: event.target.value } : row,
                ))
              }
            />
          </label>
          <button
            type="button"
            className="danger tiny"
            onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function ExpenseModal({
  row,
  month,
  categories,
  accounts,
  onClose,
  onSaved,
}: {
  row: BudgetMonthRow | null;
  month: string;
  categories: Category[];
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: (startsOn?: string) => void;
}) {
  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    row
      ? {
          name: row.name,
          amount: String(row.monthlyAmount),
          frequency: row.frequency,
          weekday: row.weekday ?? "friday",
          anchorDate: row.anchorDate ?? "",
          dueDate: row.dueDay ? dueDateInput(month, row.dueDay) : `${month}-01`,
          categoryId: row.categoryId ?? "",
          accountId: row.accountId ?? "",
          carryIn: row.carryIn ? String(row.carryIn) : "",
          months: row.plannedMonths.map((item) => ({
            yearMonth: item.yearMonth,
            amount: String(item.amount),
          })),
        }
      : { ...EMPTY_EXPENSE, dueDate: `${month}-01` },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => categoryOptionsFor(categories, "expense"), [categories]);

  function set<K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const schedule = {
      frequency: draft.frequency,
      weekday: draft.frequency === "weekly" ? draft.weekday : null,
      anchorDate: draft.frequency === "biweekly" ? draft.anchorDate : null,
      dueDay: draft.frequency === "monthly" ? Number(draft.dueDate.slice(8, 10)) : null,
    };
    const carryIn = draft.carryIn.trim() ? Number(draft.carryIn) : 0;
    const monthAmounts = draft.months.map((item) => ({
      yearMonth: item.yearMonth,
      amount: Number(item.amount),
    }));
    try {
      if (row) {
        await api.updateFixedExpense(row.id, {
          name: draft.name,
          monthlyAmount: Number(draft.amount),
          ...schedule,
          categoryId: draft.categoryId || null,
          accountId: draft.accountId || null,
          carryIn,
          monthAmounts,
        });
        onSaved();
      } else {
        const created = await api.createFixedExpense({
          name: draft.name,
          monthlyAmount: Number(draft.amount),
          ...schedule,
          categoryId: draft.categoryId || null,
          accountId: draft.accountId || null,
          startsOn: month,
          carryIn,
          monthAmounts,
        });
        onSaved(created.startsOn);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={row ? `Edit ${row.name}` : "Add expense"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="Rent"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label>
          Frequency
          <select
            value={draft.frequency}
            onChange={(e) => set("frequency", e.target.value as PayFrequency)}
          >
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
          </select>
        </label>
        <label>
          Usual {occurrenceAmountLabel(draft.frequency).replace(/^Amount/, "amount")} (CAD)
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
            required
            placeholder={draft.frequency === "monthly" ? "1800" : "100"}
          />
        </label>
        {draft.frequency === "weekly" && (
          <label className="span-2">
            Day of the week
            <select
              value={draft.weekday}
              onChange={(e) => set("weekday", e.target.value as Weekday)}
            >
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {weekdayName(day)}
                </option>
              ))}
            </select>
          </label>
        )}
        {draft.frequency === "biweekly" && (
          <label className="span-2">
            First due date
            <input
              type="date"
              value={draft.anchorDate}
              onChange={(e) => set("anchorDate", e.target.value)}
              required
            />
          </label>
        )}
        {draft.frequency === "monthly" && (
          <label className="span-2">
            Due date
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              required
            />
          </label>
        )}
        <label className="span-2">
          Category (optional)
          <select value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">No category — enter paid by hand</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted span-2 modal-hint">
          Several bills can use the same category. Spending counts on this bill when it is the only
          one with that category, or when the payment name matches this bill.
        </p>
        <AccountField
          label="Pay from"
          value={draft.accountId}
          accounts={accounts}
          onChange={(value) => set("accountId", value)}
        />
        <label className="span-2">
          Already left over when it started (optional)
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={draft.carryIn}
            onChange={(e) => set("carryIn", e.target.value)}
            placeholder="0"
          />
        </label>
        <MonthAmountList
          rows={draft.months}
          defaultMonth={month}
          onChange={(months) => setDraft((current) => ({ ...current, months }))}
        />
        <p className="muted span-2 modal-hint">
          The usual amount repeats. A month listed here replaces that month’s planned total and leaves every other
          month on the usual amount.
        </p>
        {!row && (
          <p className="muted span-2 modal-hint">
            {draft.frequency === "monthly"
              ? `Starts in ${formatYearMonth(month)}. The due date repeats on that day each month, so the weekly forecast can see it.`
              : `Starts in ${formatYearMonth(month)}, then repeats.`}
          </p>
        )}
        {row && draft.frequency === "monthly" && (
          <p className="muted span-2 modal-hint">
            The bill is due on this day every month, and the weekly forecast uses that day.
          </p>
        )}
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={row ? "Save" : "Add expense"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function SalaryModal({
  row,
  month,
  categories,
  accounts,
  onClose,
  onSaved,
}: {
  row: SalaryMonthRow | null;
  month: string;
  categories: Category[];
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<SalaryDraft>(() =>
    row
      ? {
          name: row.name,
          amount: String(row.amount),
          anchorDate: row.anchorDate ?? "",
          categoryId: row.categoryId ?? "",
          accountId: row.accountId ?? "",
          rates: row.rates.map((rate) => ({
            effectiveOn: rate.effectiveOn,
            amount: String(rate.amount),
          })),
        }
      : EMPTY_SALARY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => categoryOptionsFor(categories, "income"), [categories]);

  function set<K extends keyof SalaryDraft>(key: K, value: SalaryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setRate(index: number, key: "effectiveOn" | "amount", value: string) {
    setDraft((current) => ({
      ...current,
      rates: current.rates.map((rate, rateIndex) =>
        rateIndex === index ? { ...rate, [key]: value } : rate,
      ),
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const rates = draft.rates
      .filter((rate) => rate.effectiveOn || rate.amount)
      .map((rate) => ({
        effectiveOn: rate.effectiveOn,
        amount: Number(rate.amount),
      }));
    try {
      if (row) {
        await api.updateSalary(row.id, {
          name: draft.name,
          amount: Number(draft.amount),
          anchorDate: draft.anchorDate,
          categoryId: draft.categoryId || null,
          accountId: draft.accountId || null,
          rates,
        });
      } else {
        await api.createSalary({
          name: draft.name,
          amount: Number(draft.amount),
          anchorDate: draft.anchorDate,
          startsOn: month,
          categoryId: draft.categoryId || null,
          accountId: draft.accountId || null,
          rates,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={row ? `Edit ${row.name}` : "Add salary"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="Paie Armando"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label>
          Starting paycheck (CAD)
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
            required
            placeholder="1500"
          />
        </label>
        <label>
          A payday
          <input
            type="date"
            value={draft.anchorDate}
            onChange={(e) => set("anchorDate", e.target.value)}
            required
          />
        </label>
        <label className="span-2">
          Income category (optional)
          <select value={draft.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">No category</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <AccountField
          label="Deposit into"
          value={draft.accountId}
          accounts={accounts}
          onChange={(value) => set("accountId", value)}
        />
        <div className="span-2 salary-changes">
          <div className="salary-changes-head">
            <span>Later paychecks</span>
            <button
              type="button"
              className="secondary tiny"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  rates: [...current.rates, { effectiveOn: "", amount: "" }],
                }))
              }
            >
              Add a change
            </button>
          </div>
          {draft.rates.map((rate, index) => (
            <div className="salary-change" key={index}>
              <label>
                From
                <input
                  type="month"
                  value={rate.effectiveOn}
                  onChange={(e) => setRate(index, "effectiveOn", e.target.value)}
                  required
                />
              </label>
              <label>
                New paycheck (CAD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={rate.amount}
                  onChange={(e) => setRate(index, "amount", e.target.value)}
                  required
                  placeholder="2950"
                />
              </label>
              <button
                type="button"
                className="danger tiny"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    rates: current.rates.filter((_, rateIndex) => rateIndex !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <p className="muted span-2 modal-hint">
          Paid every 2 weeks from the payday above. The starting amount lasts until a change. Each
          change applies from that month until the next one — a raise in March, then a higher amount
          in July when taxes stop.
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={row ? "Save" : "Add salary"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function PaidModal({
  row,
  month,
  accounts,
  onClose,
  onSaved,
}: {
  row: BudgetMonthRow;
  month: string;
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const bounds = monthBounds(month);
  const remaining = Math.max(0, Math.round((row.planned - row.spent) * 100) / 100);
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : "");
  const [date, setDate] = useState(paymentDate(month, row.dates));
  const [accountId, setAccountId] = useState(row.accountId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearManual() {
    setBusy(true);
    setError(null);
    try {
      await api.setFixedExpenseMonth(row.id, month, { paidAmount: null });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const paid = Number(amount);
    if (!amount.trim() || !Number.isFinite(paid) || paid <= 0) {
      setError("Enter the amount you paid");
      return;
    }
    if (!accountId) {
      setError("Pick the account that paid");
      return;
    }
    if (date < bounds.from || date > bounds.to) {
      setError("The payment date has to be in this month");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createTransaction({
        accountId,
        date,
        amount: row.categoryId ? paid : -paid,
        payee: row.name,
        categoryId: row.categoryId,
      });
      if (row.categoryId) {
        if (row.spentSource === "manual") {
          await api.setFixedExpenseMonth(row.id, month, { paidAmount: null });
        }
      } else {
        const already = row.spentSource === "manual" ? row.spent : 0;
        await api.setFixedExpenseMonth(row.id, month, {
          paidAmount: Math.round((already + paid) * 100) / 100,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay ${row.name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="modal-summary">
          <div>
            <span className="muted">Planned</span>
            <strong>{formatCad(row.planned)}</strong>
          </div>
          <div>
            <span className="muted">Already paid</span>
            <strong>{formatCad(row.spent)}</strong>
          </div>
          <div>
            <span className="muted">Still to pay</span>
            <strong>{formatCad(remaining)}</strong>
          </div>
        </div>
        <label>
          Amount (CAD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={remaining > 0 ? remaining.toFixed(2) : "0.00"}
            required
            autoFocus
          />
        </label>
        <label>
          Date
          <input
            type="date"
            min={bounds.from}
            max={bounds.to}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label>
          Pay from
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
            <option value="">Choose an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted modal-hint">
          This adds the payment to the register and takes it out of the account balance.
          {row.categoryId
            ? " Spending in this category counts as paid. If another bill uses the same category, only a payment with this bill's name counts here."
            : " The same amount counts as paid on this bill."}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          {row.spentSource === "manual" && row.categoryId && (
            <button type="button" className="secondary" disabled={busy} onClick={() => void clearManual()}>
              Use category spending
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function paymentDate(month: string, dates: string[]): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const upcoming = dates.find((date) => date >= today);
  if (upcoming && upcoming.slice(0, 7) === month) return upcoming;
  const last = dates[dates.length - 1];
  if (last && last.slice(0, 7) === month) return last;
  if (today.slice(0, 7) === month) return today;
  return `${month}-01`;
}

function SavingsPlans({
  rows,
  onEdit,
  onDelete,
}: {
  rows: SavingsMonthRow[];
  onEdit: (row: SavingsMonthRow) => void;
  onDelete: (row: SavingsMonthRow) => void;
}) {
  return (
    <>
      <h3 className="section-label">Objectives</h3>
      {rows.length === 0 ? (
        <p className="empty">No savings objective yet. Add a weekly or monthly amount to track.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Objective</th>
                <th>Cadence</th>
                <th className="num">Planned</th>
                <th className="num">Saved</th>
                <th className="num">Still to save</th>
                <th className="actions-col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row-title">{row.name}</div>
                    <div className="row-sub">
                      {row.fromAccountName} → {row.toAccountName}
                      {row.broughtForward > 0
                        ? ` · Behind ${formatCad(row.broughtForward)}`
                        : row.broughtForward < 0
                          ? ` · Ahead ${formatCad(-row.broughtForward)}`
                          : ""}
                    </div>
                  </td>
                  <td>
                    {row.frequency === "weekly"
                      ? `Weekly${row.weekday ? ` · ${weekdayName(row.weekday)}s` : ""}`
                      : "Monthly"}
                    <div className="row-sub">
                      {row.customDates
                        ? "Custom dates"
                        : `${row.occurrences} × ${formatCad(eachAmount(row))}${row.plannedOverridden ? " · This month only" : ""}`}
                    </div>
                  </td>
                  <td className="num">{formatCad(row.planned)}</td>
                  <td className={`num ${row.saved < 0 ? "balance neg" : "balance pos"}`}>
                    {formatCad(row.saved)}
                  </td>
                  <td className={`num ${row.remaining > 0 ? "balance neg" : "balance pos"}`}>
                    {formatCad(row.remaining)}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="secondary tiny"
                      aria-label={`Edit ${row.name}`}
                      onClick={() => onEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger tiny"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => onDelete(row)}
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
    </>
  );
}

function eachAmount(row: SavingsMonthRow): number {
  if (row.occurrences <= 0) return row.amount;
  return round2(row.planned / row.occurrences);
}

function SavingsPlanModal({
  row,
  month,
  accounts,
  onClose,
  onSaved,
}: {
  row: SavingsMonthRow | null;
  month: string;
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const pots = accounts.filter((account) => isPot(account.type));
  const cash = accounts.filter((account) => isCash(account.type));
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(row ? String(row.amount) : "");
  const [frequency, setFrequency] = useState<SavingsFrequency>(row?.frequency ?? "weekly");
  const [weekday, setWeekday] = useState<Weekday>(row?.weekday ?? "friday");
  const [fromAccountId, setFromAccountId] = useState(row?.fromAccountId ?? cash[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(row?.toAccountId ?? pots[0]?.id ?? "");
  const [months, setMonths] = useState(
    row?.monthAmounts.map((item) => ({ yearMonth: item.yearMonth, amount: String(item.amount) })) ?? [],
  );
  const [intervals, setIntervals] = useState(
    row?.intervals?.map((item) => ({ from: item.from, to: item.to, amount: String(item.amount) })) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eachLabel = frequency === "weekly" ? "Amount each week (CAD)" : "Amount each month (CAD)";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const pot = pots.find((account) => account.id === toAccountId);
    const planName = name.trim() || pot?.name || "";
    setBusy(true);
    setError(null);
    const body = {
      name: planName,
      amount: Number(amount),
      frequency,
      weekday: frequency === "weekly" ? weekday : null,
      fromAccountId,
      toAccountId,
      monthAmounts: months.map((item) => ({
        yearMonth: item.yearMonth,
        amount: Number(item.amount),
      })),
      intervals: intervals.map((item) => ({
        from: item.from,
        to: item.to,
        amount: Number(item.amount),
      })),
    };
    try {
      if (row) await api.updateSavingsPlan(row.id, body);
      else await api.createSavingsPlan({ ...body, startsOn: month });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={row ? `Edit ${row.name}` : "Add savings objective"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={pots.find((account) => account.id === toAccountId)?.name ?? "Epargne"}
          />
        </label>
        <label>
          How often
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as SavingsFrequency)}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>
          {frequency === "weekly" ? "Usual amount each week (CAD)" : "Usual amount each month (CAD)"}
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            placeholder={frequency === "weekly" ? "50" : "200"}
            autoFocus
          />
        </label>
        {frequency === "weekly" && (
          <label className="span-2">
            Day
            <select value={weekday} onChange={(event) => setWeekday(event.target.value as Weekday)}>
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {weekdayName(day)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          From
          <select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} required>
            {cash.length === 0 && <option value="">No chequing or cash account</option>}
            {cash.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Into
          <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} required>
            {pots.length === 0 && <option value="">No savings or placement account</option>}
            {pots.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <MonthAmountList
          rows={months}
          defaultMonth={month}
          amountLabel={eachLabel}
          onChange={setMonths}
        />
        <DateIntervalList
          month={month}
          rows={intervals}
          amountLabel={eachLabel}
          onChange={setIntervals}
        />
        <p className="muted span-2 modal-hint">
          The usual amount repeats on each {frequency === "weekly" ? "week" : "month"}. A month or a date range uses
          the amount you enter for each of those usual days, and every other day stays on the usual amount. A date
          range wins on the days it covers. Any money recorded in this account counts, and money leaving it sets the
          objective back.
        </p>
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={row ? "Save" : "Add objective"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function SavingsTable({
  pots,
  moves,
  setAside,
  withdrawn,
  onDelete,
}: {
  pots: AccountWithBalance[];
  moves: SavingsMove[];
  setAside: number;
  withdrawn: number;
  onDelete: (move: SavingsMove) => void;
}) {
  if (pots.length === 0) {
    return <p className="empty">Add a savings or placement account before moving money aside.</p>;
  }
  return (
    <>
      <div className="account-mini">
        {pots.map((account) => (
          <div key={account.id}>
            <span>
              {account.name}
              <span className="row-sub"> · {account.type === "placement" ? "Placement" : "Savings"}</span>
            </span>
            <span className="balance">{formatCad(account.balance)}</span>
          </div>
        ))}
      </div>
      <p className="tab-note">
        Set aside {formatCad(setAside)} · Withdrawn {formatCad(withdrawn)}
      </p>
      {moves.length === 0 ? (
        <p className="empty">Nothing recorded in savings or placement this month.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Movement</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Amount</th>
                <th className="actions-col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => (
                <tr key={move.id}>
                  <td>{formatShortDate(move.date)}</td>
                  <td>
                    <div className="row-title">{movementLabel(move)}</div>
                    {move.memo && <div className="row-sub">{move.memo}</div>}
                  </td>
                  <td>{move.fromName}</td>
                  <td>{move.toName}</td>
                  <td className="num balance">{formatCad(move.amount)}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="danger tiny"
                      aria-label={`Delete ${move.paired ? "transfer" : "transaction"} from ${move.fromName} to ${move.toName}`}
                      onClick={() => onDelete(move)}
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
    </>
  );
}

function SavingsModal({
  month,
  accounts,
  onClose,
  onSaved,
}: {
  month: string;
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const pots = accounts.filter((account) => isPot(account.type));
  const cash = accounts.filter((account) => isCash(account.type));
  const [direction, setDirection] = useState<SavingsDirection>("in");
  const [cashAccountId, setCashAccountId] = useState(cash[0]?.id ?? "");
  const [potAccountId, setPotAccountId] = useState(pots[0]?.id ?? "");
  const [date, setDate] = useState(defaultTransferDate(month));
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = pots.length > 0 && cash.length > 0;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTransfer({
        fromAccountId: direction === "in" ? cashAccountId : potAccountId,
        toAccountId: direction === "in" ? potAccountId : cashAccountId,
        date,
        amount: Number(amount),
        memo: memo || null,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={direction === "in" ? "Set money aside" : "Withdrawal"} onClose={onClose}>
      <form className="form-grid cols-2" onSubmit={onSubmit}>
        <label className="span-2">
          Movement
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as SavingsDirection)}
          >
            <option value="in">To savings or placement</option>
            <option value="out">Withdrawal</option>
          </select>
        </label>
        <label>
          {direction === "in" ? "From" : "Back to"}
          <select
            value={cashAccountId}
            onChange={(event) => setCashAccountId(event.target.value)}
            required
          >
            {cash.length === 0 && <option value="">No chequing or cash account</option>}
            {cash.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {direction === "in" ? "Into" : "From"}
          <select
            value={potAccountId}
            onChange={(event) => setPotAccountId(event.target.value)}
            required
          >
            {pots.length === 0 && <option value="">No savings or placement account</option>}
            {pots.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          Amount (CAD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            placeholder="200"
            autoFocus
          />
        </label>
        <label className="span-2">
          Memo
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder={direction === "in" ? "Chequing to savings" : "Savings back to chequing"}
          />
        </label>
        <p className="muted span-2 modal-hint">
          {direction === "in"
            ? "The amount leaves the first account and arrives in savings or a placement. It is not spending."
            : "The amount leaves savings or a placement and returns to chequing or cash."}
        </p>
        {!ready && (
          <p className="error span-2">
            This needs a chequing or cash account and a savings or placement account.
          </p>
        )}
        {error && <p className="error span-2">{error}</p>}
        <ModalActions busy={busy} label={direction === "in" ? "Set aside" : "Withdraw"} onClose={onClose} />
      </form>
    </Modal>
  );
}

function savingsTransfers(transactions: Transaction[], accounts: AccountWithBalance[]): SavingsMove[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.transferGroupId) continue;
    const legs = groups.get(tx.transferGroupId) ?? [];
    legs.push(tx);
    groups.set(tx.transferGroupId, legs);
  }

  const moves: SavingsMove[] = [];
  for (const legs of groups.values()) {
    const from = legs.find((leg) => leg.amount < 0);
    const to = legs.find((leg) => leg.amount > 0);
    if (!from || !to) continue;
    const fromAccount = byId.get(from.accountId);
    const toAccount = byId.get(to.accountId);
    if (!fromAccount || !toAccount) continue;
    const fromPot = isPot(fromAccount.type);
    const toPot = isPot(toAccount.type);
    if (!fromPot && !toPot) continue;
    const direction: SavingsMove["direction"] = fromPot && toPot ? "between" : toPot ? "in" : "out";
    const pot = toPot ? toAccount : fromAccount;
    moves.push({
      id: from.id,
      date: from.date,
      amount: Math.abs(from.amount),
      memo: from.memo || to.memo,
      fromName: fromAccount.name,
      toName: toAccount.name,
      direction,
      potLabel: pot.type === "placement" ? "placement" : "savings",
      paired: true,
    });
  }

  for (const tx of transactions) {
    if (tx.transferGroupId || tx.deletedAt || tx.amount === 0) continue;
    const account = byId.get(tx.accountId);
    if (!account || !isPot(account.type)) continue;
    const inbound = tx.amount > 0;
    const who = tx.payee?.trim() || "Register";
    moves.push({
      id: tx.id,
      date: tx.date,
      amount: Math.abs(tx.amount),
      memo: tx.memo,
      fromName: inbound ? who : account.name,
      toName: inbound ? account.name : who,
      direction: inbound ? "in" : "out",
      potLabel: account.type === "placement" ? "placement" : "savings",
      paired: false,
    });
  }
  moves.sort((a, b) => (a.date === b.date ? a.fromName.localeCompare(b.fromName) : a.date < b.date ? -1 : 1));
  return moves;
}

function movementLabel(move: SavingsMove): string {
  if (move.direction === "out") return "Withdrawal";
  if (move.direction === "between") return "Between accounts";
  return move.potLabel === "placement" ? "To placement" : "To savings";
}

function isPot(type: AccountWithBalance["type"]): boolean {
  return type === "savings" || type === "placement";
}

function isCash(type: AccountWithBalance["type"]): boolean {
  return type === "checking" || type === "cash";
}

function defaultTransferDate(month: string): string {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (month === current) {
    return `${current}-${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${month}-01`;
}

function RemoveObjectiveModal({
  name,
  month,
  onClose,
  onRemoved,
}: {
  name: string;
  month: string;
  onClose: () => void;
  onRemoved: (scope: "month" | "future" | "all") => Promise<void>;
}) {
  const [busy, setBusy] = useState<"month" | "future" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = formatYearMonth(month);

  async function remove(scope: "month" | "future" | "all") {
    setBusy(scope);
    setError(null);
    try {
      await onRemoved(scope);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <Modal title={`Remove ${name}`} onClose={onClose}>
      <p>Transfers already recorded stay in the accounts. Choose which months to remove.</p>
      {error && <p className="error">{error}</p>}
      <div className="choice-list">
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => remove("month")}>
          {busy === "month" ? "Removing…" : `Only ${label}`}
        </button>
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => remove("future")}>
          {busy === "future" ? "Removing…" : `${label} and every month after`}
        </button>
        <button type="button" className="danger solid" disabled={busy !== null} onClick={() => remove("all")}>
          {busy === "all" ? "Removing…" : "Every month"}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy !== null} autoFocus>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function RemoveExpenseModal({
  row,
  month,
  onClose,
  onRemoved,
}: {
  row: BudgetMonthRow;
  month: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState<"month" | "future" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = formatYearMonth(month);

  async function remove(scope: "month" | "future" | "all") {
    setBusy(scope);
    setError(null);
    try {
      await api.deleteFixedExpense(row.id, month, scope);
      onRemoved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <Modal title={`Remove ${row.name}`} onClose={onClose}>
      <p>Recorded payments stay in the accounts. Choose which budget months to remove.</p>
      {error && <p className="error">{error}</p>}
      <div className="choice-list">
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => remove("month")}>
          {busy === "month" ? "Removing…" : `Only ${label}`}
        </button>
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => remove("future")}>
          {busy === "future" ? "Removing…" : `${label} and every month after`}
        </button>
        <button type="button" className="danger solid" disabled={busy !== null} onClick={() => remove("all")}>
          {busy === "all" ? "Removing…" : "Every month"}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy !== null} autoFocus>
          Cancel
        </button>
      </div>
    </Modal>
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

function AccountField({
  label,
  value,
  accounts,
  onChange,
}: {
  label: string;
  value: string;
  accounts: AccountWithBalance[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="span-2">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function detailLine(categoryName: string | null, accountName: string | null): string {
  const category = categoryName ?? "No category";
  return accountName ? `${category} · ${accountName}` : category;
}

function Stat({
  label,
  amount,
  signed = false,
  note,
}: {
  label: string;
  amount: number;
  signed?: boolean;
  note?: string;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={signed ? `value ${moneyClass(amount)}` : "value"}>{formatCad(amount)}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

function splitPlanned(total: number, dates: string[]): { date: string; amount: number }[] {
  if (dates.length === 0) return [];
  const each = Math.round((total / dates.length) * 100) / 100;
  return dates.map((date, index) => ({
    date,
    amount:
      index === dates.length - 1
        ? Math.round((total - each * (dates.length - 1)) * 100) / 100
        : each,
  }));
}

function moneyClass(amount: number): string {
  if (amount < 0) return "balance neg";
  if (amount > 0) return "balance pos";
  return "balance";
}

function formatSignedCad(amount: number): string {
  if (Math.abs(amount) < 0.005) return formatCad(0);
  return `${amount > 0 ? "+" : "−"}${formatCad(Math.abs(amount))}`;
}

function paidSourceLabel(row: BudgetMonthRow): string {
  if (row.spentSource === "manual") return "Recorded payment";
  if (row.spentSource === "category") return "From category";
  return "Not recorded";
}

function dueDateInput(yearMonth: string, dueDay: number): string {
  const shown = dateOnDay(yearMonth, dueDay);
  if (Number(shown.slice(8, 10)) === dueDay) return shown;
  return `${yearMonth.slice(0, 4)}-01-${String(dueDay).padStart(2, "0")}`;
}

function scheduleLabel(row: BudgetMonthRow): string {
  if (row.frequency === "weekly") {
    return row.weekday ? `Weekly · ${weekdayName(row.weekday)}s` : "Weekly";
  }
  if (row.frequency === "biweekly") return "Every 2 weeks";
  return "Monthly";
}

function occurrenceAmountLabel(frequency: PayFrequency): string {
  if (frequency === "weekly") return "Amount each week";
  if (frequency === "biweekly") return "Amount each time";
  return "Amount each month";
}

function formatYearMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!year || monthIndex < 0) return yearMonth;
  return new Date(year, monthIndex, 1).toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
  });
}

function formatPayAmounts(amounts: number[]): string {
  const first = amounts[0];
  if (first === undefined) return "—";
  if (amounts.every((amount) => amount === first)) return formatCad(first);
  return amounts.map((amount) => formatCad(amount)).join(" · ");
}

function formatPaydayList(dates: string[]): string {
  const first = dates[0];
  if (!first) return "";
  const monthLabel = formatShortDate(first).replace(/[\d\s]+$/, "").trim();
  const days = dates.map((iso) => String(Number(iso.slice(8))));
  return `${monthLabel} ${days.join(", ")}`;
}

function formatShortDate(iso: string): string {
  const [yearText, monthText, dayText] = iso.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
}

function categoryOptionsFor(
  categories: Category[],
  kind: Category["kind"],
): { id: string; label: string }[] {
  const matching = categories.filter((category) => category.kind === kind);
  const byParent = new Map<string | null, Category[]>();
  for (const category of matching) {
    const list = byParent.get(category.parentId) ?? [];
    list.push(category);
    byParent.set(category.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  }

  const options: { id: string; label: string }[] = [];
  for (const root of byParent.get(null) ?? []) {
    options.push({ id: root.id, label: root.name });
    for (const child of byParent.get(root.id) ?? []) {
      options.push({ id: child.id, label: `${root.name} — ${child.name}` });
    }
  }
  return options;
}
