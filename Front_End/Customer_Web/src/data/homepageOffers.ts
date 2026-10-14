/**
 * CUST-WEB-001-CP08a-C2: the sample offers of the booking-portal home page and of `/offers`.
 *
 * MOCK DATA. These offers are not in the booking system: there is no discount engine, no promotion rule
 * and no price here that a quote, a hold or a reservation reads. The prices are made-up amounts for the
 * layout; they are not rates seeded in the database and nothing derived from them reaches the backend.
 * The real price of a stay is the one the booking system returns for the dates the guest chooses. The
 * pictures are the Riverside property photographs the site already publishes (`public/media/the-bha-riverside`).
 */

export interface MockOffer {
  id: string;
  /** The `?offer=<slug>` highlight on `/offers`. */
  slug: string;
  title: string;
  summary: string;
  /** File under `/media/the-bha-riverside/`. */
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  /** Whole VND per night, before the offer. */
  originalPrice: number;
  /** Whole VND per night, with the offer. Always below `originalPrice`. */
  discountPrice: number;
}

export const OFFER_BADGE = "Ưu đãi minh hoạ";
export const OFFER_DISCLOSURE =
  "Ưu đãi và giá trên đây là dữ liệu minh hoạ, chưa gắn với hệ thống đặt phòng. Giá thật được hệ thống tính theo ngày bạn chọn khi tìm phòng.";
export const OFFER_REAL_CTA = "Xem phòng và giá thực tế";

export const MOCK_OFFERS: readonly MockOffer[] = [
  {
    id: "offer-1",
    slug: "dat-som-can-ho-1-phong-ngu",
    title: "Đặt sớm cho căn hộ 1 phòng ngủ",
    summary: "Lên kế hoạch trước một tháng để có kỳ nghỉ thong thả ở Đà Nẵng.",
    image: "one-bedroom-living.webp",
    imageAlt: "Phòng khách có ghế sofa và bàn trà, phía sau là giường ngủ",
    imageWidth: 1536,
    imageHeight: 1024,
    originalPrice: 1350000,
    discountPrice: 1089000,
  },
  {
    id: "offer-2",
    slug: "cuoi-tuan-can-ho-2-phong-ngu",
    title: "Cuối tuần cho gia đình",
    summary: "Căn hộ 2 phòng ngủ cho chuyến đi cuối tuần cùng người thân.",
    image: "two-bedroom-living.webp",
    imageAlt: "Phòng khách có ghế sofa, bàn trà và tivi",
    imageWidth: 1537,
    imageHeight: 1023,
    originalPrice: 2150000,
    discountPrice: 1849000,
  },
  {
    id: "offer-3",
    slug: "o-dai-ngay-can-ho-thoang",
    title: "Ở dài ngày thoải mái",
    summary: "Dành cho chuyến công tác hoặc kỳ nghỉ kéo dài nhiều đêm.",
    image: "open-view-living.webp",
    imageAlt: "Phòng khách có ghế sofa, bàn ăn nhỏ và giường ngủ phía sau cửa kính",
    imageWidth: 1553,
    imageHeight: 1013,
    originalPrice: 1590000,
    discountPrice: 1247000,
  },
  {
    id: "offer-4",
    slug: "ky-nghi-gan-ho-boi",
    title: "Kỳ nghỉ thư giãn bên hồ bơi",
    summary: "Một ngày chậm rãi với hồ bơi trên sân thượng của chỗ nghỉ.",
    image: "rooftop-pool-day.webp",
    imageAlt: "Hồ bơi trên sân thượng vào ban ngày",
    imageWidth: 1600,
    imageHeight: 1067,
    originalPrice: 1780000,
    discountPrice: 1479000,
  },
  {
    id: "offer-5",
    slug: "giua-tuan-yen-tinh",
    title: "Giữa tuần yên tĩnh",
    summary: "Chọn đêm giữa tuần để có không gian riêng và thời gian thư thả.",
    image: "two-bedroom-bedroom-1.webp",
    imageAlt: "Phòng ngủ với giường đôi và tủ quần áo",
    imageWidth: 1537,
    imageHeight: 1023,
    originalPrice: 1290000,
    discountPrice: 1059000,
  },
  {
    id: "offer-6",
    slug: "nhom-ban-can-ho-2-phong-ngu",
    title: "Nhóm bạn đi chung",
    summary: "Hai phòng ngủ cho nhóm bạn chia nhau chi phí cho chuyến đi.",
    image: "open-view-balcony.webp",
    imageAlt: "Ban công nhìn ra hàng cây và khu dân cư",
    imageWidth: 1600,
    imageHeight: 981,
    originalPrice: 2390000,
    discountPrice: 1949000,
  },
];
