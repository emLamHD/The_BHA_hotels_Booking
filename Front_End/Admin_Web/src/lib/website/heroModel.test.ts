import { describe, expect, it } from "vitest";
import type { HeroMedia, HeroSlide, MenuLocale, WebsiteHero } from "@/lib/api/website";
import {
  DEFAULT_FOCAL, MAX_SLIDES, addSlide, draftOf, draftProblems, fingerprint, intervalProblem, locateField, moveSlide, parseInterval, patchSharedText, patchSlideText,
  previewText, removeSlide, replaceSlideMedia, summarizeChanges, textProblem, toBody,
} from "./heroModel";

const LOCALES: MenuLocale[] = [
  { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true },
  { code: "en", displayName: "English", nativeName: "English", isDefault: false, isActive: true, isContentSource: false },
];
const slide = (id: string, mediaId = `m-${id}`): HeroSlide => ({
  id, mediaId, focalPosition: "40% 50%", alt: { vi: `Ảnh ${id}`, en: `Photo ${id}` }, caption: { vi: `Chú thích ${id}`, en: null },
});
const hero = (slides: HeroSlide[] = [slide("a"), slide("b"), slide("c")]): WebsiteHero => ({
  revision: "r1", version: 1, updatedAtUtc: "2026-10-17T01:00:00+00:00", locales: LOCALES, fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  texts: { title: { vi: "Tiêu đề", en: "Title" }, description: { vi: "Mô tả", en: null }, primaryAction: { vi: "Tìm phòng", en: null }, secondaryAction: { vi: "Xem", en: null } },
  slides, media: [],
});
const media = (id: string): HeroMedia => ({ id, kind: "upload", url: `/api/admin/v1/website/hero/media/${id}`, seedFile: null, contentType: "image/png", byteSize: 100, width: 1920, height: 900, createdAtUtc: "2026-10-17T00:00:00Z" });
const draft = () => draftOf(hero());
const ids = (d: ReturnType<typeof draft>) => d.slides.map((item) => item.id);

describe("the interval is whole seconds from 3 to 60", () => {
  it.each([["3", 3], ["6", 6], [" 60 ", 60], ["03", 3]])("%s is %s", (text, seconds) => expect(parseInterval(text)).toBe(seconds));
  it.each(["2", "61", "0", "-5", "6.5", "6,5", "abc", "", " ", "6s", "1e1", "+6", "1000"])("%j is not accepted", (text) => {
    expect(parseInterval(text)).toBeNull();
    expect(intervalProblem(text)).toMatch(/3 đến 60/);
  });
});

describe("a text is plain, required and short", () => {
  it("explains each problem and accepts a Vietnamese or French line with its accents", () => {
    expect(textProblem("", 10)).toMatch(/Nhập/);
    expect(textProblem("   ", 10)).toMatch(/Nhập/);
    expect(textProblem(null, 10)).toMatch(/Nhập/);
    expect(textProblem("<b>x</b>", 20)).toMatch(/< >/);
    expect(textProblem("hai\ndòng", 20)).toMatch(/xuống dòng/);
    expect(textProblem("a".repeat(11), 10)).toMatch(/11\/10/);
    expect(textProblem("Đường chân trời Đà Nẵng, crépuscule", 80)).toBeNull();
  });
});

describe("the draft", () => {
  it("is the loaded hero, and has nothing to save until something differs", () => {
    expect(fingerprint(draft())).toBe(fingerprint(draftOf(hero())));
    expect(toBody(draft())).toMatchObject({ fontKey: "default", autoplayEnabled: true, intervalSeconds: 6 });
  });

  it("treats an empty text and a missing one as the same, and a different order as different", () => {
    const base = draft();
    expect(fingerprint(patchSharedText(base, "description", "en", "  "))).toBe(fingerprint(base));
    expect(fingerprint(patchSharedText(base, "description", "en", "Hello"))).not.toBe(fingerprint(base));
    const moved = moveSlide(base, "b", -1);
    expect(moved.ok && fingerprint(moved.draft)).not.toBe(fingerprint(base));
  });

  it("has no body while the interval is not a number", () => {
    expect(toBody({ ...draft(), interval: "abc" })).toBeNull();
  });
});

describe("slides: add, replace, remove, move", () => {
  it("adds a centred slide with the required languages' texts empty (nothing is invented), up to ten", () => {
    const added = addSlide(draft(), media("new"), "n1", LOCALES);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.draft.slides[3]).toEqual({ id: "n1", mediaId: "new", focalPosition: DEFAULT_FOCAL, alt: { vi: "", en: null }, caption: { vi: "", en: null } });
    const full = { ...draft(), slides: Array.from({ length: MAX_SLIDES }, (_, index) => slide(`s${index}`)) };
    const refused = addSlide(full, media("x"), "n2", LOCALES);
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.reason).toMatch(/tối đa 10/);
  });

  it("a replaced picture keeps the slide's id, place and texts, and the focal point goes back to the centre", () => {
    const replaced = replaceSlideMedia(draft(), "b", media("new"));
    expect(replaced.ok && replaced.draft.slides[1]).toEqual({ ...slide("b"), mediaId: "new", focalPosition: DEFAULT_FOCAL });
    expect(replaced.ok && ids(replaced.draft)).toEqual(["a", "b", "c"]);
    expect(replaceSlideMedia(draft(), "gone", media("new")).ok).toBe(false);
  });

  it("never removes the last slide, and removes any other", () => {
    const removed = removeSlide(draft(), "b");
    expect(removed.ok && ids(removed.draft)).toEqual(["a", "c"]);
    const last = { ...draft(), slides: [slide("only")] };
    const refused = removeSlide(last, "only");
    expect(!refused.ok && refused.reason).toMatch(/ít nhất 1 ảnh/);
  });

  it("moves up and down within the list and says so at the ends", () => {
    const up = moveSlide(draft(), "c", -1);
    expect(up.ok && ids(up.draft)).toEqual(["a", "c", "b"]);
    const down = moveSlide(draft(), "a", 1);
    expect(down.ok && ids(down.draft)).toEqual(["b", "a", "c"]);
    expect(moveSlide(draft(), "a", -1).ok).toBe(false);
    expect(moveSlide(draft(), "c", 1).ok).toBe(false);
  });
});

describe("problems stop a Save and name their field", () => {
  it("a loaded hero has none", () => {
    expect(draftProblems(draft(), LOCALES).blocking).toBe(0);
  });

  it("counts a missing Vietnamese text, a bad interval, a bad font and a bad text in another language, per slide and per field", () => {
    let d = patchSharedText(draft(), "title", "vi", "");
    d = patchSlideText(d, "a", "alt", "vi", "<x>");
    d = patchSlideText(d, "b", "caption", "en", "a".repeat(500));
    d = { ...d, interval: "2", fontKey: "comic" as never };
    const problems = draftProblems(d, LOCALES);
    expect(problems.texts.title.vi).toBeDefined();
    expect(problems.slideTexts.a.alt.vi).toMatch(/< >/);
    expect(problems.slideTexts.b.caption.en).toMatch(/\/60/);
    expect(problems.interval).toBeTruthy();
    expect(problems.fontKey).toBeTruthy();
    expect(problems.blocking).toBe(5);
  });

  it("an empty text in a language that is not required is not a problem", () => {
    expect(draftProblems(patchSharedText(draft(), "title", "en", ""), LOCALES).blocking).toBe(0);
  });

  it("no slide, or too many, is a problem", () => {
    expect(draftProblems({ ...draft(), slides: [] }, LOCALES).slides).toBeTruthy();
    expect(draftProblems({ ...draft(), slides: Array.from({ length: 11 }, (_, index) => slide(`s${index}`)) }, LOCALES).slides).toBeTruthy();
  });
});

describe("a server refusal finds its field on the draft that was sent", () => {
  it("maps each field name the API uses", () => {
    const d = draft();
    expect(locateField("fontKey", d)).toEqual({ kind: "fontKey" });
    expect(locateField("intervalSeconds", d)).toEqual({ kind: "interval" });
    expect(locateField("slides", d)).toEqual({ kind: "slides" });
    expect(locateField("texts.description.en", d)).toEqual({ kind: "shared", field: "description", locale: "en" });
    expect(locateField("slides[1].alt.vi", d)).toEqual({ kind: "slide", slideId: "b", part: "alt", locale: "vi" });
    expect(locateField("slides[2].mediaId", d)).toEqual({ kind: "slide", slideId: "c", part: "mediaId", locale: null });
    expect(locateField("slides[9].alt.vi", d)).toBeNull();
    expect(locateField("expectedRevision", d)).toBeNull();
    expect(locateField(null, d)).toBeNull();
  });
});

describe("preview and summary", () => {
  it("shows a language's own text, else the default language's, else Vietnamese", () => {
    expect(previewText({ vi: "Việt", en: "English" }, "en", "vi")).toBe("English");
    expect(previewText({ vi: "Việt", en: null }, "en", "vi")).toBe("Việt");
    expect(previewText({ vi: "Việt", fr: "" }, "fr", "en")).toBe("Việt");
    expect(previewText({}, "fr", "en")).toBe("");
  });

  it("says in a line what differs from the saved hero", () => {
    const base = draft();
    expect(summarizeChanges(base, base)).toEqual([]);
    let d = removeSlide(base, "b");
    expect(d.ok && summarizeChanges(base, d.draft)).toEqual(["xoá 1 ảnh"]);
    d = moveSlide(base, "c", -1);
    expect(d.ok && summarizeChanges(base, d.draft)).toEqual(["đổi thứ tự ảnh"]);
    d = replaceSlideMedia(base, "a", media("z"));
    expect(d.ok && summarizeChanges(base, d.draft)).toEqual(["thay ảnh"]);
    expect(summarizeChanges(base, { ...patchSharedText(base, "title", "vi", "Khác"), fontKey: "system-serif", interval: "9" })).toEqual(["sửa nội dung chữ", "đổi font", "đổi cách tự chuyển ảnh"]);
  });
});
