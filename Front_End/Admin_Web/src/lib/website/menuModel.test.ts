import { describe, expect, it } from "vitest";
import type { MenuItem, MenuLocale } from "@/lib/api/website";
import {
  addItem, canonical, checkHref, checkLabel, depthOf, draftProblems, fingerprint, hasBlockingProblem, indent, locateField, moveWithinSiblings,
  outdent, patchItem, previewTree, problemsOf, rebaseDraft, removeItem, setPlacement, summarizeChanges, type Move,
} from "./menuModel";

const LOCALES: MenuLocale[] = [
  { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true },
  { code: "en", displayName: "English", nativeName: "English", isDefault: false, isActive: true, isContentSource: false },
  { code: "fr", displayName: "French", nativeName: "Français", isDefault: false, isActive: true, isContentSource: false },
];

const item = (id: string, parentId: string | null, placement: "primary" | "secondary" | null, vi: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id, parentId, placement: parentId === null ? placement ?? "primary" : null, isEnabled: true, href: "/" + id, openInNewTab: false, labels: { vi, en: vi + " en", fr: null }, ...over,
});

/** a, b(b1, b2(b21)), c · secondary: s */
const TREE = canonical([
  item("a", null, "primary", "A"), item("b", null, "primary", "B"), item("b1", "b", null, "B1"), item("b2", "b", null, "B2"), item("b21", "b2", null, "B21"),
  item("c", null, "primary", "C"), item("s", null, "secondary", "S"),
]);
const ids = (items: readonly MenuItem[]) => items.map((entry) => entry.id).join(",");
const ok = (move: Move) => {
  if (!move.ok) throw new Error(move.reason);
  return move.items;
};

describe("the draft is always a valid tree in tree order", () => {
  it("canonical puts the main row first, then the secondary group, each entry followed by its sub-entries", () => {
    expect(ids(canonical([item("s", null, "secondary", "S"), item("b1", "b", null, "B1"), item("a", null, "primary", "A"), item("b", null, "primary", "B")]))).toBe("a,b,b1,s");
  });

  it("moves an entry up or down among its siblings, taking its sub-entries along; the ends say so", () => {
    expect(ids(ok(moveWithinSiblings(TREE, "b", -1)))).toBe("b,b1,b2,b21,a,c,s");
    expect(ids(ok(moveWithinSiblings(TREE, "b", 1)))).toBe("a,c,b,b1,b2,b21,s");
    expect(ids(ok(moveWithinSiblings(TREE, "b2", -1)))).toBe("a,b,b2,b21,b1,c,s");
    expect(moveWithinSiblings(TREE, "a", -1)).toMatchObject({ ok: false });
    expect(moveWithinSiblings(TREE, "c", 1)).toMatchObject({ ok: false });
    expect(moveWithinSiblings(TREE, "s", 1)).toMatchObject({ ok: false });          // the only one of its group
  });

  it("indent puts an entry inside the one above it, last; the first of a group cannot", () => {
    const moved = ok(indent(TREE, "c"));
    expect(ids(moved)).toBe("a,b,b1,b2,b21,c,s");
    expect(moved.find((entry) => entry.id === "c")).toMatchObject({ parentId: "b", placement: null });
    expect(ids(ok(indent(TREE, "b")))).toBe("a,b,b1,b2,b21,c,s".replace("a,b", "a,b"));   // b joins a
    expect(ok(indent(TREE, "b")).find((entry) => entry.id === "b")).toMatchObject({ parentId: "a" });
    expect(indent(TREE, "a")).toMatchObject({ ok: false });
    expect(indent(TREE, "b1")).toMatchObject({ ok: false });
  });

  it("outdent places an entry right after its parent, in the parent's group", () => {
    expect(ids(ok(outdent(TREE, "b1")))).toBe("a,b,b2,b21,b1,c,s");
    expect(ok(outdent(TREE, "b1")).find((entry) => entry.id === "b1")).toMatchObject({ parentId: null, placement: "primary" });
    expect(ok(outdent(TREE, "b21")).find((entry) => entry.id === "b21")).toMatchObject({ parentId: "b", placement: null });
    expect(outdent(TREE, "a")).toMatchObject({ ok: false });
  });

  it("never allows a fifth level: indenting that would push a subtree past four is refused", () => {
    const deep = canonical([item("r", null, "primary", "R"), item("x", "r", null, "X"), item("y", "x", null, "Y"), item("z", "y", null, "Z"), item("w", null, "primary", "W")]);
    expect(depthOf(deep, "z")).toBe(4);
    expect(indent(deep, "w")).toMatchObject({ ok: true });                       // w (1 level) under r → level 2
    const sibling = canonical([...deep, item("w2", "r", null, "W2")]);
    expect(indent(sibling, "w2")).toMatchObject({ ok: true });                   // w2 under x: level 3
    // y2 (with a child) sits beside y at level 3: under y it would be level 4 with a child at level 5.
    const tall = canonical([...deep, item("y2", "x", null, "Y2"), item("y21", "y2", null, "Y21")]);
    expect(indent(tall, "y2")).toMatchObject({ ok: false });
    expect(indent(canonical([...deep, item("y2", "x", null, "Y2")]), "y2")).toMatchObject({ ok: true });   // a leaf fits at level 4
    expect(addItem(deep, "z", "primary", { vi: "x" })).toMatchObject({ ok: false });
  });

  it("a top-level entry moves to the other group at its end; a sub-entry cannot", () => {
    const moved = ok(setPlacement(TREE, "a", "secondary"));
    expect(ids(moved)).toBe("b,b1,b2,b21,c,s,a");
    expect(setPlacement(TREE, "b1", "secondary")).toMatchObject({ ok: false });
    expect(setPlacement(TREE, "a", "primary")).toMatchObject({ ok: false });
  });

  it("deleting an entry that has children is refused with how many; a leaf goes", () => {
    const refused = removeItem(TREE, "b");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok === false && refused.reason).toContain("2 mục con");
    expect(ids(ok(removeItem(TREE, "b21")))).toBe("a,b,b1,b2,c,s");
  });

  it("adds a top-level entry to a group, or a sub-entry, enabled and with a safe default link", () => {
    const added = ok(addItem(TREE, null, "secondary", { vi: "Mới" }, "new1"));
    expect(added.at(-1)).toMatchObject({ id: "new1", placement: "secondary", parentId: null, isEnabled: true, href: "/" });
    const child = ok(addItem(TREE, "a", "primary", { vi: "Con" }, "new2"));
    expect(child.find((entry) => entry.id === "new2")).toMatchObject({ parentId: "a", placement: null });
  });
});

describe("the same field rules as the server", () => {
  it.each(["/", "/riverside", "/blog?x=1#y", "#", "#faq", "https://example.com/a?b=1"])("accepts the link %s", (href) => expect(checkHref(href)).toBeNull());
  it.each(["", "javascript:alert(1)", "//evil.example", "/\\evil", "/%2F%2Fevil", "/%5Cevil", "http://example.com", "data:text/html,x", "/a b", "https://u:p@example.com", "faq", "#a#b"])("refuses the link %j", (href) => expect(checkHref(href)).not.toBeNull());

  it("a label is plain text of 1 to 80 characters", () => {
    expect(checkLabel("Ưu đãi")).toBeNull();
    for (const bad of ["", "  ", "<b>x</b>", "a".repeat(81)]) expect(checkLabel(bad)).not.toBeNull();
  });

  it("Vietnamese and the default language are required; another language left empty is flagged, not refused", () => {
    const entry = item("x", null, "primary", "X", { labels: { vi: "X", en: null, fr: "" } });
    const problems = problemsOf(entry, LOCALES);
    expect(hasBlockingProblem(problems)).toBe(false);
    expect(problems.missing).toEqual(["en", "fr"]);
    const blank = problemsOf(item("y", null, "primary", "Y", { labels: { vi: " ", en: "Y" } }), LOCALES);
    expect(blank.labels.vi).toBeTruthy();
    expect(hasBlockingProblem(blank)).toBe(true);
    expect(hasBlockingProblem(problemsOf(item("z", null, "primary", "Z", { href: "javascript:x" }), LOCALES))).toBe(true);
    expect(draftProblems(TREE, LOCALES).size).toBe(TREE.length);
  });
});

describe("comparing the draft with what was loaded", () => {
  it("the fingerprint ignores insignificant differences (empty vs missing label, surrounding spaces) and sees real ones", () => {
    const a = [item("a", null, "primary", "A", { labels: { vi: "A", en: null } })];
    const b = [item("a", null, "primary", "A", { labels: { vi: " A ", en: "", fr: null } })];
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(patchItem(a, "a", { href: "/other" })));
    expect(fingerprint(TREE)).not.toBe(fingerprint(ok(moveWithinSiblings(TREE, "a", 1))));
  });

  it("counts added, removed and edited entries (a move is an edit)", () => {
    const draft = ok(addItem(ok(removeItem(TREE, "b21")), null, "primary", { vi: "N" }, "n"));
    expect(summarizeChanges(TREE, draft)).toEqual({ added: 1, removed: 1, edited: 0 });
    expect(summarizeChanges(TREE, patchItem(TREE, "a", { isEnabled: false }))).toEqual({ added: 0, removed: 0, edited: 1 });
    expect(summarizeChanges(TREE, ok(moveWithinSiblings(TREE, "a", 1))).edited).toBe(2);
    expect(summarizeChanges(TREE, TREE)).toEqual({ added: 0, removed: 0, edited: 0 });
  });

  it("a server field such as items[3].href points back at the draft entry", () => {
    expect(locateField("items[1].href", TREE)).toEqual({ id: "b", prop: "href", sub: null });
    expect(locateField("items[2].labels.en", TREE)).toEqual({ id: "b1", prop: "labels", sub: "en" });
    expect(locateField("items[99].href", TREE)).toBeNull();
    expect(locateField("expectedRevision", TREE)).toBeNull();
    expect(locateField(null, TREE)).toBeNull();
  });
});

describe("the preview is what a visitor would see", () => {
  it("shows enabled entries only, a disabled parent hides its branch, labels fall back to the default language", () => {
    const draft = patchItem(patchItem(TREE, "b", { isEnabled: false }), "c", { labels: { vi: "Ba", en: null, fr: null } });
    const en = previewTree(draft, "en", "vi");
    expect(en.primary.map((node) => node.label)).toEqual(["A en", "Ba"]);                       // B (with its branch) is hidden; C falls back to vi
    expect(previewTree(TREE, "vi", "vi").primary.find((node) => node.id === "b")?.children.map((node) => node.id)).toEqual(["b1", "b2"]);
    expect(previewTree(TREE, "en", "vi").secondary.map((node) => node.href)).toEqual(["/s"]);
    expect(previewTree([], "vi", "vi")).toEqual({ primary: [], secondary: [] });
  });
});

describe("after a stale save, my edits go on top of what someone else saved", () => {
  it("content edits are laid over the server's tree: the other editor's changes to other entries stay", () => {
    const theirs = patchItem(TREE, "a", { href: "/their-link" });                       // another editor changed A
    const mine = patchItem(TREE, "c", { labels: { vi: "C của tôi", en: null, fr: null } });   // I changed C
    const rebased = rebaseDraft(TREE, mine, theirs);
    expect(rebased.how).toBe("merged");
    expect(rebased.items.find((entry) => entry.id === "a")?.href).toBe("/their-link");
    expect(rebased.items.find((entry) => entry.id === "c")?.labels.vi).toBe("C của tôi");
    expect(ids(rebased.items)).toBe(ids(theirs));
  });

  it("an entry both of us edited takes my edit; an entry the other editor added is kept; one they moved stays where they put it", () => {
    const theirs = ok(addItem(ok(moveWithinSiblings(patchItem(TREE, "b", { href: "/theirs" }), "c", -1)), null, "primary", { vi: "Mới" }, "n"));
    const mine = patchItem(TREE, "b", { href: "/mine" });
    const rebased = rebaseDraft(TREE, mine, theirs);
    expect(rebased.items.find((entry) => entry.id === "b")?.href).toBe("/mine");
    expect(rebased.items.some((entry) => entry.id === "n")).toBe(true);
    expect(ids(rebased.items)).toBe(ids(theirs));
  });

  it("when I changed the structure the draft is kept as it is and the screen says so", () => {
    const mine = ok(removeItem(TREE, "b21"));
    const rebased = rebaseDraft(TREE, mine, patchItem(TREE, "a", { href: "/theirs" }));
    expect(rebased.how).toBe("kept");
    expect(ids(rebased.items)).toBe(ids(mine));
  });
});
