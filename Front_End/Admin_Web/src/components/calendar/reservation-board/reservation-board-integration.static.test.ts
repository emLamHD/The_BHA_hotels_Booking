import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);

function read(relativePath: string): string {
  return readFileSync(path.join(DIR, relativePath), "utf8");
}

describe("ReservationBoard no-mock-fallback (FRONTEND INTEGRATION CONTRACT)", () => {
  it("ReservationBoard.tsx no longer imports the mock read source or the legacy mock-typed timeline/dialog", () => {
    const source = read("ReservationBoard.tsx");
    // Only the actual import/require statements matter here — the header
    // doc comment names these modules in prose to explain why they are
    // intentionally left unused, which is not itself an import.
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line));
    const importSource = importLines.join("\n");
    for (const forbidden of ["mockData", "reservationRuntime", "TimelineItemDetailsDialog", "./ReservationTimeline"]) {
      expect(importSource).not.toContain(forbidden);
    }
  });

  it("ReservationBoard.tsx renders only the real Admin API client, not any local fixture", () => {
    const source = read("ReservationBoard.tsx");
    expect(source).toContain("fetchActiveProperties");
    expect(source).toContain("fetchReservationBoard");
    expect(source).toContain("@/lib/api/client");
  });
});

describe("ReservationBoard retry gate shares reconciliation's board-authority predicate (PMS-CAL-001.2-CP04C.3-C2)", () => {
  it("imports boardCanEvaluate from reconciliation.ts, and its retry-gate predicate calls it rather than inlining a containment check", () => {
    const source = read("ReservationBoard.tsx");
    // Import statements can span multiple lines (a wrapped named-import
    // list), so this matches the whole `import ... ;` block rather than a
    // single line the way the file's other import-presence check above does.
    const importBlocks = source.match(/^import\s[\s\S]*?;$/gm) ?? [];
    expect(importBlocks.join("\n")).toContain("boardCanEvaluate");

    const boardCanShowMatch = source.match(/const boardCanShow[\s\S]*?;\n/);
    expect(boardCanShowMatch).not.toBeNull();
    const boardCanShowSource = boardCanShowMatch![0];
    // Must delegate to the shared predicate...
    expect(boardCanShowSource).toContain("boardCanEvaluate(");
    // ...and must not reintroduce CP04C.3-C1's bug: an inlined full-containment
    // comparison here would silently diverge from evaluateUncertainWrite's
    // per-operation rule for any move segment longer than the board's own
    // maximum visible window.
    expect(boardCanShowSource).not.toMatch(/\.from\s*<=/);
    expect(boardCanShowSource).not.toMatch(/\.to\s*>=/);
  });
});

describe("Calendar page layout preservation", () => {
  const pagePath = "../../../app/(admin)/(others-pages)/calendar/page.tsx";

  it("still renders the FullCalendar-backed Calendar component alongside the Reservation Board", () => {
    const source = read(pagePath);
    expect(source).toContain('import Calendar from "@/components/calendar/Calendar"');
    expect(source).toContain("<Calendar");
    expect(source).toContain("<ReservationBoard");
  });

  it("renders ReservationBoard as a self-contained component taking no props", () => {
    const source = read(pagePath);
    expect(source).toMatch(/<ReservationBoard\s*\/>/);
  });
});
