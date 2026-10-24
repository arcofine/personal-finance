import { useEffect, useState } from "react";
import type { YearBudget, YearBudgetMonth, YearPot } from "@pf/core";
import { api, formatCad } from "../api";
import { BarChart, ChartFrame, ChartLegend, LineChart } from "../charts";

const INCOME = "var(--accent)";
const EXPENSE = "var(--negative)";
const SAVINGS = "#2a6f97";
const PLACEMENT = "#8a6232";

export function YearPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [draft, setDraft] = useState(() => String(new Date().getFullYear()));
  const [report, setReport] = useState<YearBudget | null>(null);
  const [error, setError] = useState<string | null>(null);

  function chooseYear(next: number) {
    const clamped = Math.min(2100, Math.max(2000, next));
    setYear(clamped);
    setDraft(String(clamped));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await api.yearBudget(year);
        if (!cancelled) {
          setReport(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  const visible = report?.year === year ? report : null;
  const savingsPots = visible?.pots.filter((pot) => pot.type === "savings") ?? [];
  const placementPots = visible?.pots.filter((pot) => pot.type === "placement") ?? [];
  const decemberRecorded = visible?.months[11]?.recorded ?? false;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Year</h1>
          <p>
            The budget for the year you pick, and where savings and placements land if each
            month’s objective is met.
          </p>
        </div>
        <div className="month-nav">
          <button type="button" className="secondary" onClick={() => chooseYear(year - 1)}>
            Previous
          </button>
          <label>
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                const next = Number(draft);
                if (Number.isInteger(next)) chooseYear(next);
                else setDraft(String(year));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <button type="button" className="secondary" onClick={() => chooseYear(year + 1)}>
            Next
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!visible ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stat-row">
            <Stat label="Expected pay" value={formatCad(visible.totals.expectedIncome)} note="Paychecks in the year" />
            <Stat
              label="Planned expenses"
              value={formatCad(visible.totals.plannedExpenses)}
              note="Fixed bills in the year"
            />
            <Stat
              label="Savings"
              value={formatCad(visible.totals.plannedSavings)}
              note="Set aside over the year"
            />
            <Stat
              label="Placements"
              value={formatCad(visible.totals.plannedPlacements)}
              note="Set aside over the year"
            />
            <Stat
              label="Left after plan"
              value={formatCad(visible.totals.predictedLeft)}
              note="Pay minus expenses, savings, and placements"
              tone={visible.totals.predictedLeft < 0 ? "neg" : "pos"}
            />
            <Stat
              label="Savings in December"
              value={formatCad(visible.totals.decemberSavings)}
              note={decemberRecorded ? "Balance on record" : "If the objectives are met"}
            />
            <Stat
              label="Placements in December"
              value={formatCad(visible.totals.decemberPlacements)}
              note={decemberRecorded ? "Balance on record" : "If the objectives are met"}
            />
          </div>

          <ChartFrame
            title="Budget"
            legend={
              <ChartLegend
                series={[
                  { name: "Expected pay", color: INCOME },
                  { name: "Expenses", color: EXPENSE },
                  { name: "Savings", color: SAVINGS },
                  { name: "Placements", color: PLACEMENT },
                ]}
              />
            }
            note="Raises already on a salary are included. Groceries and other variable spending are not guessed."
          >
            <BarChart
              label={`Expected pay, expenses, savings, and placements for ${visible.year}`}
              labels={visible.months.map((month) => shortMonth(month.yearMonth))}
              format={formatCad}
              series={[
                { name: "Expected pay", color: INCOME, values: visible.months.map((month) => month.expectedIncome) },
                { name: "Expenses", color: EXPENSE, values: visible.months.map((month) => month.plannedExpenses) },
                { name: "Savings", color: SAVINGS, values: visible.months.map((month) => month.plannedSavings) },
                {
                  name: "Placements",
                  color: PLACEMENT,
                  values: visible.months.map((month) => month.plannedPlacements),
                },
              ]}
            />
            <YearTable months={visible.months} />
          </ChartFrame>

          <ChartFrame
            title="Savings and placements"
            legend={
              <ChartLegend
                series={[
                  { name: "Savings", color: SAVINGS },
                  { name: "Placements", color: PLACEMENT },
                ]}
              />
            }
            note={projectionNote(visible)}
          >
            <LineChart
              label={`Savings and placement balances through ${visible.year}`}
              labels={visible.months.map((month) => shortMonth(month.yearMonth))}
              format={formatCad}
              series={[
                { name: "Savings", color: SAVINGS, values: visible.months.map((month) => month.savings) },
                {
                  name: "Placements",
                  color: PLACEMENT,
                  values: visible.months.map((month) => month.placements),
                },
              ]}
            />
            <PotList title="Savings" empty="No savings account yet." pots={savingsPots} />
            <PotList title="Placements" empty="No placement account yet." pots={placementPots} />
          </ChartFrame>
        </>
      )}
    </>
  );
}

function projectionNote(report: YearBudget): string {
  const recorded = report.months.filter((month) => month.recorded);
  const projected = report.months.filter((month) => !month.recorded);
  const lastRecorded = recorded[recorded.length - 1];
  const firstProjected = projected[0];
  if (!firstProjected) return "Balances recorded at the end of each month.";
  if (!lastRecorded) {
    return `Projected from the balance on ${mediumDate(report.asOfDate)}, plus each month’s objective from then through December ${report.year}. Money already ahead of the plan stays in the account.`;
  }
  return `Through ${monthName(lastRecorded.yearMonth)} the line is the balance on record. From ${monthName(firstProjected.yearMonth)} it adds what is still to set aside, then each later month’s objective. Money already ahead of the plan stays in the account.`;
}

function YearTable({ months }: { months: YearBudgetMonth[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Pay</th>
            <th className="num">Expenses</th>
            <th className="num">Savings</th>
            <th className="num">Placements</th>
            <th className="num">Left</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.yearMonth}>
              <td>{monthName(month.yearMonth)}</td>
              <td className="num">{formatCad(month.expectedIncome)}</td>
              <td className="num">{formatCad(month.plannedExpenses)}</td>
              <td className="num">{formatCad(month.plannedSavings)}</td>
              <td className="num">{formatCad(month.plannedPlacements)}</td>
              <td className="num">
                <span className={moneyClass(month.predictedLeft)}>{formatCad(month.predictedLeft)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">
              {formatCad(months.reduce((sum, month) => sum + month.expectedIncome, 0))}
            </td>
            <td className="num">
              {formatCad(months.reduce((sum, month) => sum + month.plannedExpenses, 0))}
            </td>
            <td className="num">
              {formatCad(months.reduce((sum, month) => sum + month.plannedSavings, 0))}
            </td>
            <td className="num">
              {formatCad(months.reduce((sum, month) => sum + month.plannedPlacements, 0))}
            </td>
            <td className="num">
              <span className={moneyClass(months.reduce((sum, month) => sum + month.predictedLeft, 0))}>
                {formatCad(months.reduce((sum, month) => sum + month.predictedLeft, 0))}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PotList({ title, empty, pots }: { title: string; empty: string; pots: YearPot[] }) {
  return (
    <div className="account-list">
      <h3 className="section-label">{title}</h3>
      {pots.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        pots.map((pot) => (
          <div className="account-row" key={pot.id}>
            <span>{pot.name}</span>
            <span className="balance">
              {formatCad(pot.january)} in January → {formatCad(pot.december)} in December
            </span>
          </div>
        ))
      )}
    </div>
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

function moneyClass(amount: number): string {
  if (amount < 0) return "balance neg";
  if (amount > 0) return "balance pos";
  return "balance";
}

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) return yearMonth;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-CA", {
    month: "long",
    timeZone: "UTC",
  });
}

function shortMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleString("en-CA", { month: "short", timeZone: "UTC" });
}

function mediumDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
