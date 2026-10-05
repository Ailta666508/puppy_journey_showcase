import { describe, expect, it } from "vitest";
import { parseHistoryLimit } from "./rehearsalHistoryLimit";

describe("history request limits", () => {
  it("preserves the default and accepts the expanded window", () => {
    expect(parseHistoryLimit(null)).toBe(20);
    expect(parseHistoryLimit("1")).toBe(1);
    expect(parseHistoryLimit("50")).toBe(50);
  });
  it.each(["", "0", "-1", "51", "1.5", "1e1", " 20", "0x14", "Infinity", "999999999999999999"])("rejects ambiguous or unbounded limit %s", (raw) => {
    expect(() => parseHistoryLimit(raw)).toThrow("limit must be an integer");
  });
});
