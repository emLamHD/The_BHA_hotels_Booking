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
    // PMS-ADMIN-AUTH-001-CP06: the board is reached through its access gate.
    expect(source).toContain("<CalendarAccessGate");
  });

  it("in LocalGate mode the gate renders ReservationBoard as a self-contained component taking no props", () => {
    const source = read("CalendarAccessGate.tsx");
    expect(source).toMatch(/mode\.mode === "LocalGate"\) return <ReservationBoard\s*\/>;/);
  });
});

describe("split-move wiring boundaries (PMS-CAL-002-CP05)", () => {
  it("the board is the only caller of the split-move client function; the seam, popover and dialog import no client function", () => {
    const importsOf = (file: string) =>
      read(file)
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line))
        .join("\n");
    expect(read("ReservationBoard.tsx")).toContain("splitMoveReservationAssignment(");
    for (const file of ["splitMoveSubmission.ts", "ReservationBoardStayPopover.tsx", "ReservationSplitMoveDialog.tsx"]) {
      expect(importsOf(file)).not.toMatch(/import \{[^}]*splitMoveReservationAssignment/);
      expect(read(file)).not.toMatch(/\bfetch\(/);
    }
  });

  it("the past-date acknowledgement is a UI fact: it is never part of the request the board sends", () => {
    const seam = read("splitMoveSubmission.ts");
    const request = seam.slice(seam.indexOf("request: {"), seam.indexOf("target,", seam.indexOf("request: {")));
    expect(request).toContain("expectedVersion: target.segment.segmentVersion");
    expect(request).not.toMatch(/pastDate|acknowledg/i);
  });

  it("the three source-consuming operations are gated by one predicate, not by their own operation-specific ones", () => {
    const source = read("ReservationBoard.tsx");
    expect(source).toContain("isSegmentAssignmentWriteUnresolved");
    expect(source).not.toContain("isSegmentMoveUnresolved");
    expect(source).not.toContain("isSegmentUnassignUnresolved");
  });
});

describe("block-move wiring boundaries (PMS-CAL-003-CP03)", () => {
  // Whole `import ... ;` statements, so a wrapped named-import list is seen in full.
  const importsOf = (file: string) => (read(file).match(/^import\s[\s\S]*?;$/gm) ?? []).join("\n");

  it("the board is the only caller of the block-move client function, exactly once; the seam, popover and dialog import no client function", () => {
    const board = read("ReservationBoard.tsx");
    expect(board.match(/\bmoveOperationalBlock\(/g)).toHaveLength(1);
    expect(importsOf("ReservationBoard.tsx")).toMatch(/\bmoveOperationalBlock\b/);
    for (const file of ["blockMoveSubmission.ts", "blockMoveTarget.ts", "ReservationBoardStayPopover.tsx", "ReservationBlockMoveDialog.tsx"]) {
      expect(importsOf(file)).not.toMatch(/import \{[^}]*\bmoveOperationalBlock\b/);
      expect(importsOf(file)).not.toMatch(/import \{[^}]*\b(cancelOperationalBlock|createOperationalBlock)\b/);
      expect(read(file)).not.toMatch(/\bfetch\(/);
    }
    // The dialog's only client import is a type.
    for (const statement of importsOf("ReservationBlockMoveDialog.tsx").split(/;\n?/).filter((l) => l.includes("@/lib/api/client"))) {
      expect(statement).toMatch(/^import type /);
    }
  });

  it("the request is built field by field from the verified target: no confirmation, actor, evidence, dates, header or role can ride along", () => {
    const seam = read("blockMoveSubmission.ts");
    const request = seam.slice(seam.indexOf("request: {"), seam.indexOf("target,", seam.indexOf("request: {")));
    expect(request).toContain("expectedVersion: block.segmentVersion");
    expect(request).toContain("destinationPhysicalRoomId: destination.id");
    expect(request).toMatch(/\.\.\.\(reason !== "" \? \{ reason \} : \{\}\)/);
    expect(request).not.toMatch(/confirm|actor|evidence|role|startDate|endDate|roomBlockId|intent\./i);
  });

  it("a cancel and a move of one block segment are gated by the one segment predicate at open and at send, in the popover's reason too", () => {
    const board = read("ReservationBoard.tsx");
    // handleCancelBlock (open), submitBlockCancel (send), isCancelBlockedForBlock (popover) — and the seam for the move.
    expect(board.match(/isBlockSegmentWriteUnresolved\(/g)).toHaveLength(3);
    expect(read("blockMoveSubmission.ts")).toContain("isBlockSegmentWriteUnresolved(");
    expect(board).not.toMatch(/isSegmentMoveUnresolved|isSegmentUnassignUnresolved/);
  });

  it("the board reads the live refs at the moment of opening and sending, not the closure the popover rendered with", () => {
    const board = read("ReservationBoard.tsx");
    const send = board.slice(board.indexOf("const submitBlockMove = useCallback("), board.indexOf("const isBlockRangeLocked = useCallback("));
    expect(send).toContain("boardStateRef.current");
    expect(send).toContain("currentBoardKeyRef.current");
    expect(send).toContain("reconciliationsRef.current");
    expect(send).toContain("blockReconciliationsRef.current");
    expect(send).toContain("capabilitiesAt(opened.propertyId).blockWrite");
    expect(send).toContain("refuseWhileStorageUnverified()");
    // Recorded, tracked and balanced in the order the other writes use.
    expect(send.indexOf("beginPendingWrite(")).toBeLessThan(send.indexOf("trackWrite(pendingToken)"));
    expect(send.indexOf("trackWrite(pendingToken)")).toBeLessThan(send.indexOf("moveOperationalBlock("));
    expect(send).toMatch(/finally \{\s*untrackWrite\(pendingToken\);/);
    const open = board.slice(board.indexOf("const handleMoveBlock = useCallback("), board.indexOf("const submitBlockMove = useCallback("));
    expect(open).toContain("boardStateRef.current");
    expect(open).toContain("currentBoardKeyRef.current");
  });

  it("the popover's block-move action is wired for blockWrite only, and the dialog is mounted with the live permission", () => {
    const board = read("ReservationBoard.tsx");
    expect(board).toMatch(/onMoveBlock=\{selection\.kind === "block" && capabilities\.blockWrite \? handleMoveBlock : undefined\}/);
    expect(board).toMatch(/blockWriteEnabled=\{capabilitiesFor\(access, blockMoveTarget\.propertyId, sessionEnded, writesPaused\)\.blockWrite\}/);
  });
});
