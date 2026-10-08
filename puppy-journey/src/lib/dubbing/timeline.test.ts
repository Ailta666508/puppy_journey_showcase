import { describe, expect, it } from "vitest";
import type { DubbingPlan } from "./contracts";
import { buildDubbingTimeline, digestDubbingTimeline, dubbingTimelineToVtt } from "./timeline";

const plan: DubbingPlan = {
  planVersion: 1, locale: "es-ES", scriptDigest: "a".repeat(64),
  lines: [
    { lineId: "line-1", ordinal: 0, speakerKey: "npc:waiter", dubbable: false, text: "¡Hola!", voicePreset: "npc" },
    { lineId: "line-2", ordinal: 1, speakerKey: "white_dog", dubbable: true, text: "Un café.", translation: "一杯咖啡。", voicePreset: "white_dog" },
    { lineId: "line-3", ordinal: 2, speakerKey: "yellow_dog", dubbable: true, text: "Un té.", voicePreset: "yellow_dog" },
  ],
};
const measured = [{ lineId: "line-1", durationMs: 1000 }, { lineId: "line-2", durationMs: 2000 }, { lineId: "line-3", durationMs: 1000 }];

describe("measured guide timeline", () => {
  it("uses decoded durations, fixed dog windows and explicit gaps without changing source content", () => {
    const timeline = buildDubbingTimeline(plan, measured, 8000);
    expect(timeline).toMatchObject({ status: "ready", durationMs: 8000, extensionMs: 0, overflowReasons: [] });
    expect(timeline.lines.map((line) => [line.startMs, line.endMs, line.windowMs])).toEqual([
      [150, 1400, 1250], [1550, 4300, 2750], [4450, 6450, 2000],
    ]);
    expect(plan.lines[0]).not.toHaveProperty("startMs");
  });

  it("requires confirmation for allowed last-frame extension and never truncates a line", () => {
    const timeline = buildDubbingTimeline(plan, measured, 5000);
    expect(timeline).toMatchObject({ status: "needs_confirmation", durationMs: 6600, extensionMs: 1600 });
    expect(timeline.lines.at(-1)!.endMs + 150).toBe(6600);
    expect(buildDubbingTimeline(plan, measured, 4000)).toMatchObject({
      status: "overflow", overflowReasons: ["EXTENSION_TOO_LONG"], durationMs: 6600,
    });
  });

  it("caps extension at four seconds even for longer source videos", () => {
    const longer = measured.map((line) => ({ ...line, durationMs: 4800 }));
    expect(buildDubbingTimeline(plan, longer, 13_000)).toMatchObject({ status: "overflow", overflowReasons: ["EXTENSION_TOO_LONG"] });
    expect(buildDubbingTimeline(plan, longer, 15_000).status).toBe("needs_confirmation");
  });

  it("rejects oversized windows and outputs instead of clamping speech", () => {
    const long = measured.map((line) => ({ ...line, durationMs: 20_000 }));
    const timeline = buildDubbingTimeline(plan, long, 30_000);
    expect(timeline.status).toBe("overflow");
    expect(timeline.overflowReasons).toEqual(["LINE_TOO_LONG", "EXTENSION_TOO_LONG", "OUTPUT_TOO_LONG"]);
    expect(timeline.lines[0].audioDurationMs).toBe(20_000);
    expect(timeline.lines[0].windowMs).toBe(20_250);
    expect(() => dubbingTimelineToVtt(timeline)).toThrow("超出时长限制");
  });

  it("rounds measured durations upward to avoid clipping fractional milliseconds", () => {
    const timeline = buildDubbingTimeline(plan, measured.map((line) => ({ ...line, durationMs: 1000.1 })), 8000.1);
    expect(timeline.sourceDurationMs).toBe(8001);
    expect(timeline.lines[0].audioDurationMs).toBe(1001);
    expect(timeline.lines[0].windowMs).toBe(1251);
    expect(timeline.lines.every((line) => Number.isInteger(line.endMs))).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, 30_001])("rejects invalid source duration %s", (duration) => {
    expect(() => buildDubbingTimeline(plan, measured, duration)).toThrow();
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid decoded audio duration %s", (duration) => {
    const bad = measured.map((line, index) => index === 0 ? { ...line, durationMs: duration } : line);
    expect(() => buildDubbingTimeline(plan, bad, 8000)).toThrow();
  });

  it("rejects missing, duplicate and unrecognized measurements", () => {
    expect(() => buildDubbingTimeline(plan, measured.slice(1), 8000)).toThrow();
    expect(() => buildDubbingTimeline(plan, [...measured, measured[0]], 8000)).toThrow();
    expect(() => buildDubbingTimeline(plan, [...measured.slice(1), { lineId: "unknown", durationMs: 1000 }], 8000)).toThrow();
  });

  it("binds consent digest to measured windows and source identity", async () => {
    const timeline = buildDubbingTimeline(plan, measured, 8000);
    const digest = await digestDubbingTimeline(timeline);
    expect(await digestDubbingTimeline(structuredClone(timeline))).toBe(digest);
    const changed = buildDubbingTimeline(plan, measured.map((line) => ({ ...line, durationMs: line.durationMs + 1 })), 8000);
    expect(await digestDubbingTimeline(changed)).not.toBe(digest);
    expect(await digestDubbingTimeline({ ...timeline, scriptDigest: "b".repeat(64) })).not.toBe(digest);
  });

  it("exports fixed-window VTT while neutralizing markup and cue injection", () => {
    const unsafe = structuredClone(plan);
    unsafe.lines[1].text = "<b>Un café & té</b>\n\n99\n00:00.000 --> 00:09.000";
    const timeline = buildDubbingTimeline(unsafe, measured, 8000);
    const vtt = dubbingTimelineToVtt(timeline);
    expect(vtt).toContain("00:00:01.550 --> 00:00:04.300");
    expect(vtt).toContain("&lt;b&gt;Un café &amp; té&lt;/b&gt; 99 00:00.000 --&gt; 00:09.000");
    expect(vtt).not.toContain("<b>");
    expect(vtt).toContain("一杯咖啡。");
    expect(dubbingTimelineToVtt(timeline, false)).not.toContain("一杯咖啡。");
  });
});
