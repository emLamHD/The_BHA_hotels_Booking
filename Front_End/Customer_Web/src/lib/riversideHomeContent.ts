import type { PropertyDto } from "@/lib/api/propertyTypes";

/**
 * CUST-WEB-001-CP08a: the words, links and pictures of the Riverside home page, with where each one comes
 * from. Nothing here is a claim the booking system cannot back: no rating, review, price, discount,
 * guest count, award or amenity that is not in the catalog. What the catalog can change (room types,
 * property amenities, check-in/out times) is rendered from the catalog by the component, never copied here.
 *
 * Sources:
 * - Address: `docs/project/PROJECT_BIBLE.md` §1 (the two Owner-approved properties). The catalog's own
 *   address is a placeholder ("Địa chỉ đang được cập nhật"), so this one is shown as the approved address
 *   and the catalog never overrides it.
 * - "15 phút": `InventoryHold.Lifetime` in `Back_End/src/TheBha.Domain/Bookings/InventoryHold.cs`.
 * - Memory-only hold/receipt, no payment, no e-mail: contract DP-07/DP-08 and the current behaviour.
 * - Pictures: the published entries of `scripts/riverside-media/manifest.json` (Owner-authorised for the
 *   demo, provenance UNVERIFIED — `riversideHomeContent.test.ts` checks file, size and alt against it).
 */

export const HOME_SECTION = {
  intro: "gioi-thieu",
  rooms: "rooms",
  guide: "booking-guide",
  faq: "faq",
} as const;

export const HOME_SECTION_IDS: readonly string[] = [HOME_SECTION.intro, HOME_SECTION.rooms, HOME_SECTION.guide, HOME_SECTION.faq];

/** The page every "view all" and "find a room" link leads to. */
export const RESULTS_PATH = "/listing-stay";

export interface SiteNavItem {
  id: string;
  name: string;
  /** A section of the home page (`/#section`), or a page of its own. */
  section?: string;
  href?: string;
}

/** The public navigation: every entry leads somewhere that works. */
export const RIVERSIDE_NAV: readonly SiteNavItem[] = [
  { id: "intro", name: "Riverside", section: HOME_SECTION.intro },
  { id: "rooms", name: "Loại phòng", section: HOME_SECTION.rooms },
  { id: "search", name: "Tìm phòng", href: RESULTS_PATH },
  { id: "guide", name: "Hướng dẫn đặt phòng", section: HOME_SECTION.guide },
  { id: "faq", name: "Thông tin cần biết", section: HOME_SECTION.faq },
];

export const RIVERSIDE_NAME = "The BHA Riverside";
export const RIVERSIDE_ADDRESS = "162 Nghiêm Xuân Yêm, Đà Nẵng";
export const HOLD_MINUTES = 15;

export interface HomeImage {
  /** File name under `/media/the-bha-riverside/`. */
  file: string;
  alt: string;
  width: number;
  height: number;
}

export const mediaUrl = (file: string) => `/media/the-bha-riverside/${file}`;

export const HERO_IMAGE: HomeImage = {
  file: "rooftop-pool-city-view.webp",
  alt: "Hồ bơi sân thượng nhìn ra toàn cảnh khu dân cư",
  width: 1600,
  height: 1067,
};

/** The picture beside the "why book here" list: the entrance with the brand's sign. */
export const INTRO_IMAGE: HomeImage = {
  file: "entrance-logo.webp",
  alt: "Cửa kính lối vào có biển hiệu The BHA Riverside và hai ghế thư giãn",
  width: 1600,
  height: 1067,
};

/** Property-level pictures for "explore the place": the pool and rooftop, the entrance and the lobby. */
export const SPACE_GALLERY: readonly HomeImage[] = [
  { file: "rooftop-pool-day.webp", alt: "Hồ bơi trên sân thượng vào ban ngày", width: 1600, height: 1067 },
  { file: "rooftop-pool-night.webp", alt: "Hồ bơi trên sân thượng về đêm", width: 1600, height: 1067 },
  { file: "rooftop-pool-seating.webp", alt: "Hồ bơi và khu bàn ghế ngồi trên sân thượng", width: 1600, height: 1067 },
  { file: "lobby-sofa.webp", alt: "Khu ghế sofa và bàn trà trong sảnh", width: 1600, height: 1067 },
  { file: "entrance-logo.webp", alt: "Cửa kính lối vào có biển hiệu The BHA Riverside và hai ghế thư giãn", width: 1600, height: 1067 },
  { file: "lobby-shelves.webp", alt: "Kệ sách và bàn ăn nhỏ trong sảnh", width: 1600, height: 985 },
];

export interface HomeBenefit {
  id: string;
  badge: string;
  title: string;
  body: string;
}

/** What the booking page really does today. Prices, rooms and times are the server's, said as such. */
export const BENEFITS: readonly HomeBenefit[] = [
  {
    id: "types",
    badge: "Loại phòng",
    title: "Chọn đúng loại căn hộ",
    body: "Xem các loại căn hộ của The BHA Riverside, mỗi loại có ảnh và sức chứa tối đa do hệ thống đặt phòng cung cấp.",
  },
  {
    id: "price",
    badge: "Giá",
    title: "Giá theo ngày bạn chọn",
    body: "Chọn ngày, số khách và số phòng để xem giá từng đêm và tổng tiền do hệ thống đặt phòng tính cho đúng lần tìm đó.",
  },
  {
    id: "hold",
    badge: "Đặt trực tiếp",
    title: "Giữ chỗ trước khi xác nhận",
    body: `Giữ chỗ trong ${HOLD_MINUTES} phút, kiểm tra lại thông tin rồi xác nhận đặt phòng ngay trên trang.`,
  },
];

export interface HomeStep {
  id: number;
  title: string;
  body: string;
}

export const BOOKING_STEPS: readonly HomeStep[] = [
  {
    id: 1,
    title: "Tìm phòng",
    body: "Chọn ngày nhận phòng, trả phòng, số khách và số phòng. Kết quả cho biết loại phòng còn trống và giá tại thời điểm tìm; lúc này chưa giữ phòng nào.",
  },
  {
    id: 2,
    title: "Xem và giữ phòng",
    body: `Mở loại phòng bạn chọn, kiểm tra lại giá rồi giữ chỗ bằng thông tin liên hệ của bạn. Phòng được giữ trong ${HOLD_MINUTES} phút.`,
  },
  {
    id: 3,
    title: "Xác nhận đặt phòng",
    body: "Xác nhận trước khi hết thời gian giữ chỗ. Khi đặt phòng được xác nhận, mã xác nhận hiện ngay trên màn hình; hãy ghi lại mã này.",
  },
];

/** "14:00:00" → "14:00"; anything that is not a clock time is not shown. */
export function clockTime(value: string | null | undefined): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The check-in/out times the booking system currently holds for the property, or null when unknown. */
export function checkTimes(property: Pick<PropertyDto, "checkInTime" | "checkOutTime"> | null | undefined): { checkIn: string; checkOut: string } | null {
  if (!property) return null;
  const checkIn = clockTime(property.checkInTime);
  const checkOut = clockTime(property.checkOutTime);
  return checkIn && checkOut ? { checkIn, checkOut } : null;
}

/** The property's amenities exactly as the catalog names them; nothing is added. */
export function amenityNames(property: Pick<PropertyDto, "amenities"> | null | undefined): string[] {
  const names: string[] = [];
  for (const amenity of property?.amenities ?? []) {
    const name = amenity.name?.trim();
    if (name && names.indexOf(name) === -1) names.push(name);
  }
  return names;
}

export interface HomeFaqItem {
  id: string;
  question: string;
  answer: string;
}

/** The questions a guest has before booking, answered from how the booking page behaves today. */
export function buildFaq(times: { checkIn: string; checkOut: string } | null): HomeFaqItem[] {
  return [
    {
      id: "dates-guests",
      question: "Tôi chọn ngày, số khách và số phòng như thế nào?",
      answer:
        "Dùng ô tìm kiếm để chọn ngày nhận phòng, ngày trả phòng, số người lớn, số trẻ em và số phòng. Mỗi lần tìm tối đa 30 đêm và từ 1 đến 10 phòng. Sức chứa theo từng loại phòng và quy tắc về ngày do hệ thống đặt phòng kiểm tra.",
    },
    {
      id: "snapshot",
      question: "Kết quả tìm phòng có nghĩa là phòng đã được giữ cho tôi?",
      answer:
        "Không. Kết quả cho biết tình trạng và giá tại thời điểm bạn tìm. Phòng chỉ được giữ khi bạn tạo giữ chỗ ở trang loại phòng.",
    },
    {
      id: "hold-vs-confirm",
      question: "Giữ chỗ và xác nhận đặt phòng khác nhau thế nào?",
      answer: `Giữ chỗ giữ phòng cho bạn trong ${HOLD_MINUTES} phút. Chỉ khi bạn xác nhận trước khi hết thời gian đó thì đặt phòng mới được ghi nhận và có mã xác nhận.`,
    },
    {
      id: "payment",
      question: "Tôi thanh toán như thế nào?",
      answer: "Trang này chưa thu tiền trực tuyến và chưa gửi email xác nhận. Việc xác nhận đặt phòng ở đây không phải là thanh toán.",
    },
    {
      id: "reload",
      question: "Nếu tôi tải lại trang hoặc đóng tab khi đang đặt phòng?",
      answer:
        "Thông tin giữ chỗ và biên nhận hiện chỉ nằm trong tab đang mở, nên tải lại hoặc đóng tab sẽ làm mất màn hình đó. Hãy ghi lại mã xác nhận ngay khi đặt phòng được xác nhận.",
    },
    {
      id: "times",
      question: "Giờ nhận phòng và trả phòng là khi nào?",
      answer: times
        ? `Hệ thống đặt phòng hiện ghi giờ nhận phòng ${times.checkIn} và giờ trả phòng ${times.checkOut}.`
        : "Giờ nhận phòng và trả phòng được hiển thị trên trang của từng loại phòng.",
    },
  ];
}
