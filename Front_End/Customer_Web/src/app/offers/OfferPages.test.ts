import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/promotions/server", () => ({ getPromotions: vi.fn(), getPromotion: vi.fn() }));
import { renderPage } from "@/lib/i18n/testkit";
import OfferPage from "./[slug]/page";
import { getPromotion } from "@/lib/promotions/server";
import { DETAIL } from "@/lib/promotions/promotionTestkit";

/**
 * BHA-BOOKING-PROMOTIONS-001: the page of one promotion. It states the programme and its conditions, leads to the right Property and room types,
 * and states no price — a price belongs to dates and only the booking system states it.
 */
const count = (markup: string, needle: string) => markup.split(needle).length - 1;
const page = (slug = "dat-som") => renderPage(OfferPage, { params: { slug } });

beforeEach(() => {
  vi.mocked(getPromotion).mockReset();
  vi.mocked(getPromotion).mockResolvedValue({ status: "ok", detail: DETAIL });
});

describe("/offers/[slug]", () => {
  it("shows the content, the conditions and the property, with one H1", async () => {
    const markup = await page();

    expect(count(markup, "<h1")).toBe(1);
    expect(markup).toContain("Đặt sớm Riverside");
    expect(markup).toContain("Áp dụng cho kỳ nghỉ từ 2 đêm.");
    expect(markup).toContain("Không áp dụng cùng ưu đãi khác.");
    expect(markup).toContain("The BHA Riverside");
    expect(markup).toMatch(/data-testid="offer-discount"[^>]*>15% tiền phòng mỗi đêm/);
    expect(markup).toMatch(/data-testid="offer-min-nights"[^>]*>2 đêm/);
    expect(markup).toMatch(/data-testid="offer-booking-period"[^>]*>Đến hết /);          // only an end: "until"
    expect(markup).toMatch(/data-testid="offer-stay-period"[^>]*>Từ .* đến hết /);        // a range
  });

  it("keeps the booking window, the stay window and the minimum nights apart", async () => {
    const markup = await page();

    expect(markup).toContain("Thời gian đặt phòng");
    expect(markup).toContain("Thời gian lưu trú");
    expect(markup).toContain("Số đêm tối thiểu");
    expect(markup).toContain("Chỉ những đêm nằm trong thời gian lưu trú được giảm");
  });

  it("states no price and says why", async () => {
    const markup = await page();

    expect(markup).toContain('data-testid="offer-no-price"');
    expect(markup).toContain("Giá sau giảm do hệ thống đặt phòng tính khi bạn chọn ngày");
    expect(markup).not.toMatch(/line-through|<del/);
    expect(markup).not.toMatch(/\d\.\d{3}\.\d{3}\s*₫/);                                    // no discounted amount anywhere
  });

  it("leads to the right Property and room types: one link per applicable room, carrying both ids and nothing about the promotion", async () => {
    const markup = await page();

    for (const room of DETAIL.roomTypes) {
      expect(markup).toContain(`/listing-stay-detail?propertyId=${DETAIL.property.id}&amp;roomTypeId=${room.id}`);
    }
    expect(markup).not.toMatch(/promo=|offer=|discount=/);
    expect(markup).toContain('href="/listing-stay"');                                      // the Riverside property also gets its general search
  });

  it("with exactly one applicable room type, the main button goes straight to that room", async () => {
    vi.mocked(getPromotion).mockResolvedValue({ status: "ok", detail: { ...DETAIL, roomTypes: [DETAIL.roomTypes[0]] } });

    const markup = await page();

    expect(markup).toContain('data-testid="offer-cta"');
    expect(count(markup, 'data-testid="offer-cta"')).toBe(1);
    expect(markup).toContain(`roomTypeId=${DETAIL.roomTypes[0].id}`);
    expect(markup).not.toContain(DETAIL.roomTypes[1].id);
  });

  it("does not offer the Riverside search for another property, and does not invent rooms", async () => {
    vi.mocked(getPromotion).mockResolvedValue({
      status: "ok", detail: { ...DETAIL, property: { ...DETAIL.property, slug: "other-hotel" }, roomTypes: [] },
    });

    const markup = await page();

    expect(markup).not.toContain('data-testid="offer-find"');
    expect(markup).not.toContain('data-testid="offer-cta"');
    expect(markup).toContain("chưa có loại phòng nào đang mở bán");
  });

  it("shows a fixed amount in the guest's currency and says it is per room per night", async () => {
    vi.mocked(getPromotion).mockResolvedValue({ status: "ok", detail: { ...DETAIL, promotion: { ...DETAIL.promotion, terms: { ...DETAIL.promotion.terms, kind: "FixedAmount", value: 200000, currencyCode: "VND" } } } });

    const markup = await page();

    expect(markup).toMatch(/200\.000\s*₫/);
    expect(markup).toContain("mỗi phòng mỗi đêm");
  });

  it("is a 404 when the API has no public promotion with that slug", async () => {
    vi.mocked(getPromotion).mockResolvedValue({ status: "missing" });

    await expect(page("an-nhap")).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("says it could not load — and is not a 404 — when the read failed", async () => {
    vi.mocked(getPromotion).mockResolvedValue({ status: "error" });

    const markup = await page();

    expect(markup).toContain('data-testid="offer-unavailable"');
  });
});
