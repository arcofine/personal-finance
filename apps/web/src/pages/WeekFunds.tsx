import type { WeekFund } from "@pf/core";
import { formatCad } from "../api";

export function WeekFunds({
  weeks,
  today,
  heading,
}: {
  weeks: WeekFund[];
  today: string;
  heading: "h2" | "h3";
}) {
  const Title = heading;
  const short = weeks.filter((week) => !week.covered).length;
  return (
    <section className="week-funds">
      <Title className={heading === "h2" ? undefined : "section-label"}>Funds for each week</Title>
      <p className="summary-lead">
        Chequing and cash only. A week is covered when that money can pay the bills still due, and
        the savings still to move. Savings and CELI are not money to spend.
      </p>
      {weeks.length === 0 ? (
        <p className="empty">No weeks to show.</p>
      ) : (
        <>
          <p className={short === 0 ? "week-fund-summary covered" : "week-fund-summary short"}>
            {short === 0
              ? "Every week shown is covered."
              : `${short} ${short === 1 ? "week comes" : "weeks come"} up short.`}
          </p>
          <div className="week-fund-grid">
            {weeks.map((week) => {
              const tone = weekTone(week);
              const current = today >= week.from && today <= week.to;
              return (
                <article
                  key={week.from}
                  className={`week-fund ${tone}${current ? " current" : ""}`}
                >
                  <header>
                    <span>{weekLabel(week.from, week.to)}</span>
                    {current && <span className="week-fund-now">This week</span>}
                  </header>
                  <strong className={`week-status ${tone}`}>{statusLabel(week)}</strong>
                  <p>Start {formatCad(week.opening)}</p>
                  {week.recordedIn > 0 && <p>Already in {formatCad(week.recordedIn)}</p>}
                  {week.recordedOut > 0 && <p>Already out {formatCad(week.recordedOut)}</p>}
                  {week.incomeDue > 0 && <p>Pay still coming {formatCad(week.incomeDue)}</p>}
                  {week.billsDue > 0 && <p>Bills still due {formatCad(week.billsDue)}</p>}
                  {week.savingsDue > 0 && <p>Still to set aside {formatCad(week.savingsDue)}</p>}
                  <p>Left {formatCad(week.closing)}</p>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function weekTone(week: WeekFund): "covered" | "tight" | "short" {
  if (week.covered) return "covered";
  if (week.closing >= -0.004) return "tight";
  return "short";
}

function statusLabel(week: WeekFund): string {
  const tone = weekTone(week);
  if (tone === "covered") return "Covered";
  const amount = formatCad(week.shortfall);
  if (tone === "tight" && week.incomeDue > 0) return `Short ${amount} before payday`;
  if (tone === "tight") return `Short ${amount}, then covered`;
  return `Short ${amount}`;
}

function weekLabel(from: string, to: string): string {
  const start = Number(from.slice(8));
  const end = Number(to.slice(8));
  const month = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1).toLocaleDateString(
    "en-CA",
    { month: "short" },
  );
  return start === end ? `${month} ${start}` : `${month} ${start}–${end}`;
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
