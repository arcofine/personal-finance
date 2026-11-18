/** Stable import hash for idempotent CSV ingest. */
export function importHash(
  accountId: string,
  date: string,
  amount: number,
  payee: string | null,
): string {
  const payload = `${accountId}|${date}|${amount.toFixed(2)}|${(payee ?? "").trim().toLowerCase()}`;
  return simpleHash(payload);
}

function simpleHash(input: string): string {
  // FNV-1a 64-bit-ish hex — good enough for duplicate detection within one account.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}
