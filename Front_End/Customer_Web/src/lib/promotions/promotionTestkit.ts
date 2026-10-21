import type { PromotionCard, PromotionDetail } from "./promotions";

/** Two public promotions as the API serves them, parsed. */
export const CARDS: PromotionCard[] = [
  {
    id: "00000000-0000-0000-0000-0000000000a1", slug: "dat-som", title: "Đặt sớm Riverside", summary: "Giảm 15% khi đặt trước", coverImageUrl: "https://api.test/api/v1/website/promotions/media/aaaaaaaa-0000-0000-0000-000000000001",
    coverAltText: "Phòng nhìn ra sông", terms: { kind: "Percent", value: 15, currencyCode: null, bookingFrom: null, bookingTo: "2026-12-31", stayFrom: "2027-01-02", stayTo: "2027-01-31", minNights: 2 },
  },
  {
    id: "00000000-0000-0000-0000-0000000000a2", slug: "cuoi-tuan", title: "Cuối tuần thư thả", summary: "Giảm 200.000 ₫ mỗi đêm", coverImageUrl: null, coverAltText: null,
    terms: { kind: "FixedAmount", value: 200000, currencyCode: "VND", bookingFrom: null, bookingTo: null, stayFrom: null, stayTo: null, minNights: 1 },
  },
];

export const DETAIL: PromotionDetail = {
  promotion: CARDS[0],
  body: ["Áp dụng cho kỳ nghỉ từ 2 đêm.", "Không áp dụng cùng ưu đãi khác."],
  property: { id: "10000000-0000-0000-0000-000000000001", name: "The BHA Riverside", slug: "the-bha-riverside" },
  allRoomTypes: false,
  roomTypes: [{ id: "30000000-0000-0000-0000-000000000001", name: "Căn hộ một phòng ngủ" }, { id: "30000000-0000-0000-0000-000000000002", name: "Căn hộ hai phòng ngủ" }],
};
