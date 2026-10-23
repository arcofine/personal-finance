import type { MonthSummary, SummaryGroup, SummaryTotals, SummaryWeek, WeekFund } from "@pf/core";
import { formatCad } from "../api";
import { WeekFunds } from "./WeekFunds";

export function MonthSummaryView({
  summary,
  funds,
  today,
  previousMonth,
}: {
  summary: MonthSummary;
  funds: WeekFund[];
  today: string;
  previousMonth: string;
}) {
  const showUnscheduled =
    summary.incomeTotals.unscheduled !== 0 || summary.expenseTotals.unscheduled !== 0;

  return (
    <div className="month-summary">
      <WeekFunds weeks={funds} today={today} heading="h3" />
      <h3 className="section-label">Opening balances</h3>
      <p className="summary-lead">Carried from {previousMonth}.</p>
      <div className="stat-row summary-balances">
        {summary.accounts.map((account) => (
          <div className="stat" key={account.id}>
            <div className="label">{account.name}</div>
            <div className={`value ${moneyClass(account.start)}`}>{formatCad(account.start)}</div>
          </div>
        ))}
      </div>

      <h3 className="section-label">Balances through the month</h3>
      <div className="table-wrap">
        <table className="data-table summary-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Start</th>
              {summary.weeks.map((week) => (
                <th key={week.from} className="num">
                  {weekLabel(week)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <div className="row-title">{account.name}</div>
                </td>
                <td className={`num ${moneyClass(account.start)}`}>{formatCad(account.start)}</td>
                {account.weekEnd.map((balance, index) => (
                  <td key={summary.weeks[index]?.from} className={`num ${moneyClass(balance)}`}>
                    {formatCad(balance)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GroupTable
        title="Income by week"
        groups={summary.income}
        totals={summary.incomeTotals}
        weeks={summary.weeks}
        showUnscheduled={showUnscheduled}
        empty="No income is planned or recorded this month."
      />
      <GroupTable
        title="Expenses by week"
        groups={summary.expenses}
        totals={summary.expenseTotals}
        weeks={summary.weeks}
        showUnscheduled={showUnscheduled}
        empty="No expenses are planned or recorded this month."
        expense
      />
    </div>
  );
}

function GroupTable({
  title,
  groups,
  totals,
  weeks,
  showUnscheduled,
  empty,
  expense = false,
}: {
  title: string;
  groups: SummaryGroup[];
  totals: SummaryTotals;
  weeks: SummaryWeek[];
  showUnscheduled: boolean;
  empty: string;
  expense?: boolean;
}) {
  return (
    <>
      <h3 className="section-label">{title}</h3>
      {groups.length === 0 ? (
        <p className="empty performance-empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table summary-table">
            <thead>
              <tr>
                <th>Group</th>
                {weeks.map((week) => (
                  <th key={week.from}>{weekLabel(week)}</th>
                ))}
                {showUnscheduled && <th>No date</th>}
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <div className="row-title">{group.name}</div>
                  </td>
                  {weeks.map((week, index) => (
                    <td key={week.from}>
                      <WeekCell
                        planned={group.planned[index] ?? 0}
                        realized={group.realized[index] ?? 0}
                        expense={expense}
                      />
                    </td>
                  ))}
                  {showUnscheduled && (
                    <td>
                      <WeekCell planned={group.unscheduled} realized={0} expense={expense} planOnly />
                    </td>
                  )}
                  <td>
                    <WeekCell
                      planned={group.plannedTotal}
                      realized={group.realizedTotal}
                      expense={expense}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {weeks.map((week, index) => (
                  <td key={week.from}>
                    <WeekCell
                      planned={totals.planned[index] ?? 0}
                      realized={totals.realized[index] ?? 0}
                      expense={expense}
                    />
                  </td>
                ))}
                {showUnscheduled && (
                  <td>
                    <WeekCell planned={totals.unscheduled} realized={0} expense={expense} planOnly />
                  </td>
                )}
                <td>
                  <WeekCell
                    planned={totals.plannedTotal}
                    realized={totals.realizedTotal}
                    expense={expense}
                  />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function WeekCell({
  planned,
  realized,
  expense,
  planOnly = false,
}: {
  planned: number;
  realized: number;
  expense: boolean;
  planOnly?: boolean;
}) {
  if (planOnly) {
    if (planned === 0) return <span className="muted">—</span>;
    return <span className="row-sub">Plan {formatCad(planned)}</span>;
  }
  if (planned === 0 && realized === 0) return <span className="muted">—</span>;
  const over = expense && planned > 0 && realized - planned > 0.004;
  return (
    <div className="summary-cell">
      <span className={over ? "balance neg" : undefined}>{formatCad(realized)}</span>
      <span className="row-sub">Plan {formatCad(planned)}</span>
    </div>
  );
}

function weekLabel(week: SummaryWeek): string {
  const start = Number(week.from.slice(8));
  const end = Number(week.to.slice(8));
  const month = new Date(
    Number(week.from.slice(0, 4)),
    Number(week.from.slice(5, 7)) - 1,
    1,
  ).toLocaleDateString("en-CA", { month: "short" });
  return start === end ? `${month} ${start}` : `${month} ${start}–${end}`;
}

function moneyClass(amount: number): string {
  if (amount < 0) return "balance neg";
  if (amount > 0) return "balance pos";
  return "balance";
}
