import { describe, expect, it } from "vitest";
import {
  decodeRehearsalHistoryCursor,
  encodeRehearsalHistoryCursor,
  pageRehearsalHistoryRows,
  rehearsalHistoryCursorFilter,
} from "./rehearsalHistoryCursor";

const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("rehearsal history cursor", () => {
  it("round trips an opaque, injection-safe cursor and builds a stable tie-break filter", () => {
    const value = { createdAt: "2026-10-07T00:00:00.000Z", id: ID };
    const decoded = decodeRehearsalHistoryCursor(encodeRehearsalHistoryCursor(value));
    expect(decoded).toEqual(value);
    expect(rehearsalHistoryCursorFilter(decoded!)).toBe(
      `created_at.lt.${value.createdAt},and(created_at.eq.${value.createdAt},id.lt.${ID})`,
    );
  });

  it.each(["", "not-base64!", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ createdAt: "bad", id: ID })).toString("base64url"), Buffer.from(JSON.stringify({ createdAt: "2026-10-07T00:00:00.000Z", id: "x),couple_id.neq.safe" })).toString("base64url")])(
    "rejects malformed cursor %s", (raw) => expect(() => decodeRehearsalHistoryCursor(raw)).toThrow("invalid rehearsal history cursor"),
  );

  it("uses one look-ahead row and the final visible row for the next cursor", () => {
    const rows = [0, 1, 2].map((index) => ({
      id: `123e4567-e89b-42d3-a456-42661417400${index}`,
      created_at: `2026-10-0${7 - index}T00:00:00.000Z`,
    }));
    const page = pageRehearsalHistoryRows(rows, 2);
    expect(page.rows).toEqual(rows.slice(0, 2));
    expect(decodeRehearsalHistoryCursor(page.nextCursor)).toEqual({ createdAt: rows[1].created_at, id: rows[1].id });
    expect(pageRehearsalHistoryRows(rows.slice(0, 2), 2).nextCursor).toBeNull();
  });
});
