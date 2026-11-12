import { useEffect, useState } from "react";
import type { WeekFund, WeekFundItem } from "@pf/core";
import { formatCad } from "../api";

type OpenList = {
  title: string;
  items: WeekFundItem[];
  total: number;
};

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
  const [open, setOpen] = useState<OpenList | null>(null);
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
              const range = weekLabel(week.from, week.to);
              return (
                <article
                  key={week.from}
                  className={`week-fund ${tone}${current ? " current" : ""}`}
                >
                  <header>
                    <span>{range}</span>
                    {current && <span className="week-fund-now">This week</span>}
                  </header>
                  <strong className={`week-status ${tone}`}>{statusLabel(week)}</strong>
                  <p>Start {formatCad(week.opening)}</p>
                  {week.recordedIn > 0 && (
                    <FundLine
                      label="Already in"
                      amount={week.recordedIn}
                      range={range}
                      onOpen={() =>
                        setOpen({
                          title: `Already in · ${range}`,
                          items: week.inflows,
                          total: week.recordedIn,
                        })
                      }
                    />
                  )}
                  {week.recordedOut > 0 && (
                    <FundLine
                      label="Already out"
                      amount={week.recordedOut}
                      range={range}
                      onOpen={() =>
                        setOpen({
                          title: `Already out · ${range}`,
                          items: week.outflows,
                          total: week.recordedOut,
                        })
                      }
                    />
                  )}
                  {week.incomeDue > 0 && <p>Pay still coming {formatCad(week.incomeDue)}</p>}
                  {week.billsDue > 0 && (
                    <FundLine
                      label="Bills still due"
                      amount={week.billsDue}
                      range={range}
                      onOpen={() =>
                        setOpen({
                          title: `Bills still due · ${range}`,
                          items: week.bills,
                          total: week.billsDue,
                        })
                      }
                    />
                  )}
                  {week.savingsDue > 0 && <p>Still to set aside {formatCad(week.savingsDue)}</p>}
                  <p>Left {formatCad(week.closing)}</p>
                </article>
              );
            })}
          </div>
        </>
      )}
      {open && <FundListDialog list={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function FundLine({
  label,
  amount,
  range,
  onOpen,
}: {
  label: string;
  amount: number;
  range: string;
  onOpen: () => void;
}) {
  return (
    <p className="week-fund-line">
      <span>
        {label} {formatCad(amount)}
      </span>
      <button
        type="button"
        className="week-fund-plus"
        aria-label={`Show ${label.toLowerCase()} for ${range}`}
        onClick={onOpen}
      >
        +
      </button>
    </p>
  );
}

function FundListDialog({ list, onClose }: { list: OpenList; onClose: () => void }) {
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={list.title}>
        <div className="modal-head">
          <h2>{list.title}</h2>
          <button type="button" className="secondary tiny" aria-label="Close" onClick={onClose} autoFocus>
            ✕
          </button>
        </div>
        {list.items.length === 0 ? (
          <p className="empty">Nothing in this list.</p>
        ) : (
          <ul className="week-fund-items">
            {list.items.map((item, index) => (
              <li key={`${item.date}-${item.name}-${item.amount}-${index}`}>
                <span>{formatItemDate(item.date)}</span>
                <span>{item.name}</span>
                <span className="num">{formatCad(item.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="week-fund-items-total">Total {formatCad(list.total)}</p>
      </div>
    </div>
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

function formatItemDate(iso: string): string {
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
