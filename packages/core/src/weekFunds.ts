import { shiftYearMonth } from "./budget.js";
import { weeksInMonth, type SummaryWeek } from "./monthSummary.js";
import { addDays, type Weekday } from "./schedule.js";
import { savingsOccurrenceAmounts, type PlannedInterval } from "./savings.js";
import { monthBounds, round2 } from "./spend.js";
import type { AccountType } from "./types.js";

export interface WeekFundAccount {
  id: string;
  type: AccountType;
  openingBalance: number;
}

export interface WeekFundMovement {
  accountId: string;
  date: string;
  amount: number;
  categoryId: string | null;
  payee: string | null;
  transferGroupId: string | null;
}

export interface WeekFundPlan {
  name: string;
  kind: "income" | "expense";
  accountId: string | null;
  categoryId: string | null;
  dates: { date: string; amount: number }[];
  /** Already attributed to this plan, including a payment on a different day. */
  recorded: number;
}

export interface WeekFundSavingsPlan {
  toAccountId: string;
  amount: number;
  frequency: "weekly" | "monthly";
  weekday: Weekday | null;
  startsOn: string;
  endsOn?: string | null;
  omittedMonths?: string[];
  monthAmounts?: { yearMonth: string; amount: number }[];
  intervals?: PlannedInterval[];
}

export interface WeekFund {
  from: string;
  to: string;
  /** Spendable balance at the start of the week. */
  opening: number;
  /** Register deposits into chequing or cash during the week. */
  recordedIn: number;
  /** Register withdrawals from chequing or cash during the week. */
  recordedOut: number;
  /** Pay still to arrive during the week. */
  incomeDue: number;
  /** Bills still to pay during the week. */
  billsDue: number;
  /** Savings and placement transfers still to make during the week. */
  savingsDue: number;
  /** Spendable balance after the week. */
  closing: number;
  /** How far below zero the balance falls during the week. */
  shortfall: number;
  covered: boolean;
}

interface Due {
  date: string;
  kind: "income" | "expense" | "savings";
  amount: number;
  accountId: string | null;
}

/**
 * Chequing and cash through each week.
 * A bill or paycheck already on the register is not applied again.
 * Money already moved into savings or a placement covers that week's objective.
 * What is still unpaid or still to set aside is applied on its date.
 * Pay landing the same day is counted before the bills.
 */
export function buildWeekFunds(input: {
  fromMonth: string;
  toMonth: string;
  accounts: WeekFundAccount[];
  movements: WeekFundMovement[];
  plans: WeekFundPlan[];
  savings: WeekFundSavingsPlan[];
}): WeekFund[] {
  const fromMonth = input.fromMonth;
  const toMonth = input.toMonth < fromMonth ? fromMonth : input.toMonth;
  const accountType = new Map(input.accounts.map((account) => [account.id, account.type]));
  const weeks = weeksBetween(fromMonth, toMonth);
  const available = input.movements.filter((movement) => !movement.transferGroupId);
  const dues: Due[] = [
    ...plansStillDue(input.plans, available),
    ...savingsStillDue(input.savings, input.movements, accountType, fromMonth, toMonth),
  ];

  let balance = openingSpendable(input.accounts, input.movements, monthBounds(fromMonth).from);
  const funds: WeekFund[] = [];

  for (const week of weeks) {
    const opening = balance;
    let low = balance;
    let recordedIn = 0;
    let recordedOut = 0;
    let incomeDue = 0;
    let billsDue = 0;
    let savingsDue = 0;
    let cursor = week.from;
    while (cursor <= week.to) {
      const todaysMovements = input.movements
        .filter((movement) => movement.date === cursor && isSpendable(accountType.get(movement.accountId)))
        .sort((a, b) => Number(a.amount < 0) - Number(b.amount < 0));
      for (const movement of todaysMovements) {
        if (movement.amount > 0) recordedIn = round2(recordedIn + movement.amount);
        else recordedOut = round2(recordedOut - movement.amount);
        balance = round2(balance + movement.amount);
        if (balance < low) low = balance;
      }
      const todays = dues.filter((due) => due.date === cursor);
      for (const kind of ["income", "savings", "expense"] as const) {
        for (const due of todays) {
          if (due.kind !== kind) continue;
          if (due.kind !== "savings" && !countsAgainstSpendable(due.accountId, accountType)) continue;
          if (due.kind === "income") incomeDue = round2(incomeDue + due.amount);
          else if (due.kind === "expense") billsDue = round2(billsDue + due.amount);
          else savingsDue = round2(savingsDue + due.amount);
          balance = round2(balance + (due.kind === "income" ? due.amount : -due.amount));
          if (balance < low) low = balance;
        }
      }
      cursor = addDays(cursor, 1);
    }
    const shortfall = low < -0.004 ? round2(-low) : 0;
    funds.push({
      from: week.from,
      to: week.to,
      opening,
      recordedIn: round2(recordedIn),
      recordedOut: round2(recordedOut),
      incomeDue,
      billsDue,
      savingsDue,
      closing: balance,
      shortfall,
      covered: shortfall === 0,
    });
  }

  return funds;
}

function weeksBetween(fromMonth: string, toMonth: string): SummaryWeek[] {
  const weeks: SummaryWeek[] = [];
  let cursor = fromMonth;
  let guard = 0;
  while (cursor <= toMonth && guard++ < 36) {
    weeks.push(...weeksInMonth(cursor));
    cursor = shiftYearMonth(cursor, 1);
  }
  return weeks;
}

function openingSpendable(
  accounts: WeekFundAccount[],
  movements: WeekFundMovement[],
  from: string,
): number {
  let balance = 0;
  for (const account of accounts) {
    if (!isSpendable(account.type)) continue;
    balance += account.openingBalance;
    for (const movement of movements) {
      if (movement.accountId === account.id && movement.date < from) balance += movement.amount;
    }
  }
  return round2(balance);
}

function plansStillDue(plans: WeekFundPlan[], movements: WeekFundMovement[]): Due[] {
  const pool = [...movements];
  const dues: Due[] = [];
  const ordered = [...plans].sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  for (const plan of ordered) {
    let recordedLeft = plan.recorded;
    const dates = [...plan.dates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const dated of dates) {
      const index = pool.findIndex((movement) => matchesPlan(plan, dated, movement, ordered));
      if (index >= 0) {
        pool.splice(index, 1);
        recordedLeft = round2(recordedLeft - Math.min(Math.max(recordedLeft, 0), dated.amount));
        continue;
      }
      if (recordedLeft >= dated.amount - 0.001) {
        recordedLeft = round2(recordedLeft - dated.amount);
        continue;
      }
      const still = round2(dated.amount - Math.max(0, recordedLeft));
      recordedLeft = 0;
      if (still > 0.001) {
        dues.push({ date: dated.date, kind: plan.kind, amount: still, accountId: plan.accountId });
      }
    }
  }
  return dues;
}

function matchesPlan(
  plan: WeekFundPlan,
  dated: { date: string; amount: number },
  movement: WeekFundMovement,
  plans: WeekFundPlan[],
): boolean {
  if (movement.transferGroupId) return false;
  if (plan.accountId && movement.accountId !== plan.accountId) return false;
  const incoming = movement.amount > 0;
  if (plan.kind === "income" ? !incoming : incoming) return false;
  const amountHit = Math.abs(Math.abs(movement.amount) - dated.amount) < 0.02;
  const categoryHit = Boolean(plan.categoryId && movement.categoryId === plan.categoryId);
  const sameMonth = movement.date.slice(0, 7) === dated.date.slice(0, 7);

  if (movement.date === dated.date) {
    if (!categoryHit) return amountHit;
    const shared = plans.some(
      (other) =>
        other !== plan &&
        other.kind === plan.kind &&
        other.categoryId === plan.categoryId &&
        (!plan.accountId || other.accountId === plan.accountId) &&
        other.dates.some((otherDate) => otherDate.date === dated.date),
    );
    if (!shared) return true;
    return amountHit || payeeMatches(movement.payee, plan.name);
  }

  return sameMonth && categoryHit && amountHit;
}

function savingsStillDue(
  plans: WeekFundSavingsPlan[],
  movements: WeekFundMovement[],
  accountType: Map<string, AccountType>,
  fromMonth: string,
  toMonth: string,
): Due[] {
  const dues: Due[] = [];
  let cursor = fromMonth;
  let guard = 0;
  while (cursor <= toMonth && guard++ < 36) {
    for (const plan of plans) {
      const dated = savingsDates(plan, cursor);
      for (const week of weeksInMonth(cursor)) {
        const inWeek = dated.filter((item) => item.date >= week.from && item.date <= week.to);
        if (inWeek.length === 0) continue;
        let pool = netTransferred(movements, accountType, plan.toAccountId, week.from, week.to);
        for (const item of inWeek) {
          const still = round2(Math.max(0, item.amount - pool));
          pool = round2(pool - item.amount);
          if (still > 0.001) dues.push({ date: item.date, kind: "savings", amount: still, accountId: null });
        }
      }
    }
    cursor = shiftYearMonth(cursor, 1);
  }
  return dues;
}

function savingsDates(
  plan: WeekFundSavingsPlan,
  yearMonth: string,
): { date: string; amount: number }[] {
  return savingsOccurrenceAmounts(plan, yearMonth);
}

function netTransferred(
  movements: WeekFundMovement[],
  accountType: Map<string, AccountType>,
  toAccountId: string,
  from: string,
  to: string,
): number {
  const groups = new Map<string, WeekFundMovement[]>();
  for (const movement of movements) {
    if (!movement.transferGroupId || movement.date < from || movement.date > to) continue;
    const legs = groups.get(movement.transferGroupId) ?? [];
    legs.push(movement);
    groups.set(movement.transferGroupId, legs);
  }
  let net = 0;
  for (const legs of groups.values()) {
    const intoPot = legs.find((leg) => leg.accountId === toAccountId && leg.amount > 0);
    const source = legs.find((leg) => leg.amount < 0);
    if (intoPot && source && isSpendable(accountType.get(source.accountId))) net += intoPot.amount;

    const outOfPot = legs.find((leg) => leg.accountId === toAccountId && leg.amount < 0);
    const back = legs.find((leg) => leg.amount > 0 && leg.accountId !== toAccountId);
    if (outOfPot && back && isSpendable(accountType.get(back.accountId))) net -= Math.abs(outOfPot.amount);
  }
  return round2(net);
}

function countsAgainstSpendable(accountId: string | null, accountType: Map<string, AccountType>): boolean {
  if (!accountId) return true;
  return isSpendable(accountType.get(accountId));
}

function isSpendable(type: AccountType | undefined): boolean {
  return type === "checking" || type === "cash";
}

function payeeMatches(payee: string | null, name: string): boolean {
  if (!payee) return false;
  return payee.trim().toLocaleLowerCase("en-CA") === name.trim().toLocaleLowerCase("en-CA");
}
