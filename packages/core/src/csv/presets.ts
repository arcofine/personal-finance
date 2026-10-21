import type { CsvBankPreset, CsvColumnMap } from "../types.js";
import { GENERIC_COLUMN_MAP } from "./parse.js";

/**
 * RBC CSV preset (stub column map).
 * Confirm headers against a real RBC download before relying on this in production.
 * Typical export uses Date, Description, CAD$.
 */
export const RBC_COLUMN_MAP: CsvColumnMap = {
  date: "Date",
  amount: "CAD$",
  payee: "Description",
  memo: "Cheque Number",
  dateFormat: "mdy",
  // RBC often shows withdrawals as negative already; leave invert off until verified.
  invertAmount: false,
};

/**
 * TD CSV preset (stub column map).
 * Confirm headers against a real TD EasyWeb download before relying on this.
 */
export const TD_COLUMN_MAP: CsvColumnMap = {
  date: "Date",
  amount: "Amount",
  payee: "Description",
  memo: "Memo",
  dateFormat: "mdy",
  invertAmount: false,
};

export function columnMapForPreset(preset: CsvBankPreset): CsvColumnMap {
  switch (preset) {
    case "rbc":
      return RBC_COLUMN_MAP;
    case "td":
      return TD_COLUMN_MAP;
    case "generic":
    default:
      return GENERIC_COLUMN_MAP;
  }
}

export const CSV_PRESET_STATUS: Record<
  CsvBankPreset,
  { ready: boolean; note: string }
> = {
  generic: {
    ready: true,
    note: "Expects headers: date, amount, payee, memo (YYYY-MM-DD dates).",
  },
  rbc: {
    ready: false,
    note: "Stub map — verify against a real RBC CSV before production use.",
  },
  td: {
    ready: false,
    note: "Stub map — verify against a real TD CSV before production use.",
  },
};
