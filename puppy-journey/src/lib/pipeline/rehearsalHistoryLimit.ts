export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 50;

/** Reject ambiguous numbers rather than silently truncating a client request. */
export function parseHistoryLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_HISTORY_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error("limit must be an integer between 1 and 50");
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > MAX_HISTORY_LIMIT) {
    throw new Error("limit must be an integer between 1 and 50");
  }
  return limit;
}
