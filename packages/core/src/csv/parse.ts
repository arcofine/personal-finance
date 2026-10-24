import type { CsvColumnMap, ParsedCsvRow } from "../types.js";
import { round2 } from "../spend.js";

/** Minimal CSV parser (handles quoted fields and commas). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]!] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

function splitCsvLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export const GENERIC_COLUMN_MAP: CsvColumnMap = {
  date: "date",
  amount: "amount",
  payee: "payee",
  memo: "memo",
  dateFormat: "ymd",
};

/**
 * Map raw CSV rows into normalized ledger rows using a column map.
 * Amounts: positive = money in; negative = money out (after optional invert).
 */
export function mapCsvRows(
  rows: Record<string, string>[],
  map: CsvColumnMap,
): { rows: ParsedCsvRow[]; errors: string[] } {
  const out: ParsedCsvRow[] = [];
  const errors: string[] = [];

  rows.forEach((raw, idx) => {
    const lineNo = idx + 2; // header is line 1
    const dateRaw = pick(raw, map.date);
    const amountRaw = pick(raw, map.amount);
    if (!dateRaw || !amountRaw) {
      errors.push(`Line ${lineNo}: missing date or amount`);
      return;
    }

    const date = normalizeDate(dateRaw, map.dateFormat ?? "ymd");
    if (!date) {
      errors.push(`Line ${lineNo}: unparseable date "${dateRaw}"`);
      return;
    }

    let amount = parseAmount(amountRaw);
    if (amount === null) {
      errors.push(`Line ${lineNo}: unparseable amount "${amountRaw}"`);
      return;
    }
    if (map.invertAmount) amount = -amount;

    out.push({
      date,
      amount: round2(amount),
      payee: map.payee ? emptyToNull(pick(raw, map.payee)) : null,
      memo: map.memo ? emptyToNull(pick(raw, map.memo)) : null,
      raw,
    });
  });

  return { rows: out, errors };
}

function pick(row: Record<string, string>, key: string): string {
  if (key in row) return row[key] ?? "";
  const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
  return found ? (row[found] ?? "") : "";
}

function emptyToNull(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$CAD\s]/gi, "").replace(/,/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;
  // Accounting negatives: (123.45)
  const paren = cleaned.match(/^\((.+)\)$/);
  const n = Number(paren ? `-${paren[1]}` : cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(
  raw: string,
  format: "ymd" | "mdy" | "dmy",
): string | null {
  const s = raw.trim();
  // Already ISO-ish
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${pad(iso[2]!)}-${pad(iso[3]!)}`;
  }

  const parts = s.split(/[\/\-.]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  let y: string, m: string, d: string;
  if (format === "ymd") {
    [y, m, d] = parts as [string, string, string];
  } else if (format === "mdy") {
    [m, d, y] = parts as [string, string, string];
  } else {
    [d, m, y] = parts as [string, string, string];
  }
  if (y.length === 2) y = `20${y}`;
  if (!/^\d{4}$/.test(y) || !m || !d) return null;
  const mi = Number(m);
  const di = Number(d);
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function pad(n: string): string {
  return n.padStart(2, "0");
}
