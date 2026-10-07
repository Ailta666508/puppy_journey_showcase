const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RehearsalHistoryCursor = { createdAt: string; id: string };

export function encodeRehearsalHistoryCursor(cursor: RehearsalHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRehearsalHistoryCursor(raw: string | null): RehearsalHistoryCursor | null {
  if (raw === null) return null;
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("invalid rehearsal history cursor");
  }
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object") throw new Error("invalid cursor object");
    const row = value as Record<string, unknown>;
    if (typeof row.createdAt !== "string" || typeof row.id !== "string" || !UUID.test(row.id)) {
      throw new Error("invalid cursor fields");
    }
    const time = Date.parse(row.createdAt);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== row.createdAt) {
      throw new Error("invalid cursor timestamp");
    }
    return { createdAt: row.createdAt, id: row.id.toLowerCase() };
  } catch (error) {
    if (error instanceof Error && error.message === "invalid rehearsal history cursor") throw error;
    throw new Error("invalid rehearsal history cursor", { cause: error });
  }
}

export function rehearsalHistoryCursorFilter(cursor: RehearsalHistoryCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export function pageRehearsalHistoryRows<T extends { id: string; created_at: string }>(
  rows: T[], limit: number,
): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > limit && last
      ? encodeRehearsalHistoryCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id })
      : null,
  };
}
