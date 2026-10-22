import { useEffect, useState } from "react";
import type { OverviewPoint, OverviewReport, WeekForecast } from "@pf/core";
import { api, formatCad } from "../api";
import { BarChart, ChartFrame, ChartLegend, LineChart } from "../charts";

const INCOME = "var(--accent)";
const EXPENSE = "var(--negative)";
const BILLS = "#b5812f";
const PLACEMENT = "#8a6232";

export function OverviewPage() {
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setOverview(await api.overview());
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const current = overview?.months.find((month) => month.yearMonth === overview.asOf) ?? null;
  const recorded = overview?.months.filter((month) => month.yearMonth <= overview.asOf) ?? [];
  const forecast = overview?.months.filter((month) => month.yearMonth >= overview.asOf) ?? [];
  const aheadLeft = forecast.reduce((sum, month) => sum + month.predictedLeft, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            Spending recorded so far, savings and placement balances, the next 7 days, and the
            months ahead from paychecks and fixed bills.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!overview || !current ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <WeekAhead week={overview.week} />

          <p className="muted overview-stand">
            Net worth {formatCad(overview.totals.netWorth)}
            {" · "}
            Chequing {formatCad(overview.totals.checking)}
            {overview.totals.cash !== 0 ? ` · Cash ${formatCad(overview.totals.cash)}` : ""}
            {overview.totals.credit !== 0 ? ` · Credit ${formatCad(overview.totals.credit)}` : ""}
          </p>

          <div className="stat-row">
            <Stat
              label="Expenses"
              value={formatCad(current.expenses ?? 0)}
              note={`Recorded in ${monthName(overview.asOf)}`}
            />
            <Stat
              label="Savings"
              value={formatCad(overview.totals.savings)}
              note={accountNote(overview.savingsAccounts.length, "savings")}
            />
            <Stat
              label="Placements"
              value={formatCad(overview.totals.placements)}
              note={accountNote(overview.placementAccounts.length, "placement")}
            />
            <Stat
              label="Left after bills"
              value={formatCad(current.predictedLeft)}
              note={`${formatCad(current.expectedIncome)} pay − ${formatCad(current.plannedExpenses)} fixed`}
              tone={current.predictedLeft < 0 ? "neg" : "pos"}
            />
          </div>

          <div className="grid-2">
            <ChartFrame
              title="Income and expenses"
              legend={
                <ChartLegend
                  series={[
                    { name: "Income", color: INCOME },
                    { name: "Expenses", color: EXPENSE },
                  ]}
                />
              }
              note={`${monthName(overview.asOf)} is what is recorded so far, not a finished month.`}
            >
              <BarChart
                label={`Recorded income and expenses from ${monthName(recorded[0]?.yearMonth ?? overview.asOf)} to ${monthName(overview.asOf)}`}
                labels={recorded.map((month) => shortMonth(month.yearMonth))}
                format={formatCad}
                series={[
                  { name: "Income", color: INCOME, values: recorded.map((month) => month.income) },
                  {
                    name: "Expenses",
                    color: EXPENSE,
                    values: recorded.map((month) => month.expenses),
                  },
                ]}
              />
              <MonthTable
                months={recorded}
                columns={[
                  { header: "Income", value: (month) => month.income, tone: "pos" },
                  { header: "Expenses", value: (month) => month.expenses, tone: "neg" },
                ]}
              />
            </ChartFrame>

            <ChartFrame
              title="Savings and placements"
              legend={
                <ChartLegend
                  series={[
                    { name: "Savings", color: INCOME },
                    { name: "Placements", color: PLACEMENT },
                  ]}
                />
              }
              note="Balance at the end of each month. A transfer into these accounts is not an expense."
            >
              <LineChart
                label={`Savings and placement balances from ${monthName(recorded[0]?.yearMonth ?? overview.asOf)} to ${monthName(overview.asOf)}`}
                labels={recorded.map((month) => shortMonth(month.yearMonth))}
                format={formatCad}
                series={[
                  {
                    name: "Savings",
                    color: INCOME,
                    values: recorded.map((month) => month.savings ?? 0),
                  },
                  {
                    name: "Placements",
                    color: PLACEMENT,
                    values: recorded.map((month) => month.placements ?? 0),
                  },
                ]}
              />
              <AccountList
                empty="No savings account yet."
                accounts={overview.savingsAccounts}
              />
              <AccountList
                empty="No placement account yet."
                accounts={overview.placementAccounts}
              />
            </ChartFrame>
          </div>

          <ChartFrame
            title="Months ahead"
            legend={
              <ChartLegend
                series={[
                  { name: "Expected pay", color: INCOME },
                  { name: "Fixed bills", color: BILLS },
                ]}
              />
            }
            note={`About ${formatCad(aheadLeft)} left after fixed bills from ${monthName(overview.asOf)} through ${monthName(forecast[forecast.length - 1]?.yearMonth ?? overview.asOf)}. Raises already on a salary are included. Groceries and other variable spending are not guessed, and nothing is added to savings or placements.`}
          >
            <BarChart
              label={`Expected pay and fixed bills from ${monthName(overview.asOf)} through ${monthName(forecast[forecast.length - 1]?.yearMonth ?? overview.asOf)}`}
              labels={forecast.map((month) => shortMonth(month.yearMonth))}
              format={formatCad}
              series={[
                {
                  name: "Expected pay",
                  color: INCOME,
                  values: forecast.map((month) => month.expectedIncome),
                },
                {
                  name: "Fixed bills",
                  color: BILLS,
                  values: forecast.map((month) => month.plannedExpenses),
                },
              ]}
            />
            <MonthTable
              months={forecast}
              columns={[
                { header: "Expected pay", value: (month) => month.expectedIncome, tone: "pos" },
                { header: "Fixed bills", value: (month) => month.plannedExpenses, tone: "neg" },
                { header: "Left", value: (month) => month.predictedLeft, tone: "auto" },
              ]}
            />
          </ChartFrame>
        </>
      )}
    </>
  );
}

function WeekAhead({ week }: { week: WeekForecast }) {
  const alerts = week.accounts.filter((account) => account.alert);
  const loose = week.items.filter(
    (item) => item.kind === "expense" && !item.recorded && !item.accountId,
  );
  const changed = week.accounts.filter((account) => account.alert || account.projected !== account.balance);

  return (
    <section className="panel">
      <div className="chart-head">
        <h2>Next 7 days</h2>
        <span className="muted">
          {mediumDate(week.from)} – {mediumDate(week.to)}
        </span>
      </div>
      {alerts.length > 0 || loose.length > 0 ? (
        <div className="week-alert" role="alert">
          {alerts.map((account) => (
            <p key={account.accountId}>
              <strong>{account.name}</strong> would be short {formatCad(account.shortfall)} on{" "}
              {mediumDate(account.shortOn ?? week.from)}. The lowest balance is {formatCad(account.lowest)}.
            </p>
          ))}
          {loose.map((item) => (
            <p key={`${item.date}-${item.name}`}>
              <strong>{item.name}</strong> on {mediumDate(item.date)} is not tied to an account, so
              this check cannot tell which balance it comes out of.
            </p>
          ))}
        </div>
      ) : (
        <p className="week-ok">Every account stays in balance through {mediumDate(week.to)}.</p>
      )}
      {week.items.length === 0 ? (
        <p className="empty">Nothing is scheduled in these days.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Account</th>
                <th className="num">Amount</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {week.items.map((item) => (
                <tr key={`${item.date}-${item.kind}-${item.name}`}>
                  <td>{mediumDate(item.date)}</td>
                  <td>{item.name}</td>
                  <td>{item.accountName ?? "Any account"}</td>
                  <td className={`num balance ${item.kind === "income" ? "pos" : "neg"}`}>
                    {formatCad(item.kind === "income" ? item.amount : -item.amount)}
                  </td>
                  <td>
                    {item.recorded
                      ? "Already in the balance"
                      : item.balanceAfter == null
                        ? "Coming"
                        : formatCad(item.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changed.length > 0 && (
        <div className="account-mini">
          {changed.map((account) => (
            <div key={account.accountId}>
              <span>{account.name}</span>
              <span className="balance">
                {formatCad(account.balance)} now → {formatCad(account.projected)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={tone ? `value balance ${tone}` : "value"}>{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function AccountList({
  accounts,
  empty,
}: {
  accounts: { id: string; name: string; balance: number }[];
  empty: string;
}) {
  if (accounts.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="account-mini">
      {accounts.map((account) => (
        <div key={account.id}>
          <span>{account.name}</span>
          <span className="balance">{formatCad(account.balance)}</span>
        </div>
      ))}
    </div>
  );
}

function MonthTable({
  months,
  columns,
}: {
  months: OverviewPoint[];
  columns: {
    header: string;
    value: (month: OverviewPoint) => number | null;
    tone: "pos" | "neg" | "auto";
  }[];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            {columns.map((column) => (
              <th className="num" key={column.header}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.yearMonth}>
              <td>{monthName(month.yearMonth)}</td>
              {columns.map((column) => {
                const value = column.value(month);
                const tone =
                  value == null || value === 0
                    ? ""
                    : column.tone === "auto"
                      ? value < 0
                        ? "neg"
                        : "pos"
                      : column.tone;
                return (
                  <td className={tone ? `num balance ${tone}` : "num"} key={column.header}>
                    {value == null ? "—" : formatCad(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function accountNote(count: number, kind: "savings" | "placement"): string {
  if (count === 0) return kind === "savings" ? "No savings account" : "No placement account";
  const noun = kind === "savings" ? "savings account" : "placement account";
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function mediumDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) return yearMonth;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shortMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const label = date.toLocaleString("en-CA", { month: "short", timeZone: "UTC" });
  if (month === "01" || month === "12") return `${label} ${year?.slice(2)}`;
  return label;
}
