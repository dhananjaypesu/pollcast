import { describe, expect, it } from "vitest";
import { percent, plural, timeAgo } from "./format";

describe("format helpers", () => {
  it("rounds percentages and handles zero votes", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBe(0);
  });

  it("pluralizes", () => {
    expect(plural(1, "vote")).toBe("1 vote");
    expect(plural(4, "vote")).toBe("4 votes");
    expect(plural(2, "person", "people")).toBe("2 people");
  });

  it("describes relative time", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(timeAgo("2026-10-20T09:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-20T09:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-20T07:00:00Z", now)).toBe("3 h ago");
  });
});
