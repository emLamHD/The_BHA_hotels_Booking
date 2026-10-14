/**
 * CUST-WEB-001-CP08a-C2: the one registry behind the home page's destination and news cards, `/blog` and
 * `/blog/<slug>`.
 *
 * Content policy: every fact below was read on the source pages listed in the post's `sources` on the editing
 * date (14/10/2026) and is written here in our own words; nothing is copied. Where the sources disagree (the
 * length of Mỹ Khê, the number of douc langurs on Sơn Trà, the number of teams of the fireworks festival) the
 * post leaves the number out and says so. There is no BHA news, event, partnership, author or comment: these
 * are travel guides and summaries of public reports, and the home page says so. Dates in the news posts are
 * the dates of the reports; what had not happened yet when it was reported is worded as planned ("dự kiến").
 * Administrative units are not named (they changed in 2025). Pictures and their credits: `data/heroSlides.ts`.
 */

export type PostKind = "destination" | "news";

export interface PostCategory {
  slug: string;
  name: string;
  description: string;
}

export const POST_CATEGORIES: readonly PostCategory[] = [
  {
    slug: "diem-den-noi-bat",
    name: "Điểm đến nổi bật",
    description: "Những nơi nên biết khi ở Đà Nẵng và vùng lân cận: biển, núi, cầu, phố cổ và cố đô.",
  },
  {
    slug: "tin-du-lich",
    name: "Tin du lịch",
    description: "Tóm tắt các bản tin công khai về du lịch Đà Nẵng, kèm nguồn để bạn đọc bản gốc.",
  },
];

export interface PostSection {
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}

export interface PostSource {
  label: string;
  publisher: string;
  url: string;
  /** ISO date of the page, when it shows one. */
  publishedAt?: string;
}

export interface TravelPost {
  id: string;
  slug: string;
  kind: PostKind;
  category: string;
  title: string;
  /** The name on a small card (a destination's name); falls back to `title`. */
  shortTitle?: string;
  excerpt: string;
  /** File under `/media/the-bha-travel/`; the credit is looked up by `creditForFile`. */
  cover: string;
  coverAlt: string;
  /** Destination guides: the editing date. News: the date of the report the summary is made from. */
  publishedAt: string;
  updatedAt: string;
  sections: readonly PostSection[];
  sources: readonly PostSource[];
  related: readonly string[];
}

const UPDATED = "2026-10-14";

const VIETNAM_TOURISM_DANANG: PostSource = {
  label: "3 ngày hoàn hảo ở Đà Nẵng",
  publisher: "Vietnam Tourism",
  url: "https://www.vietnam.travel/vi/things-to-do/3-perfect-days-danang",
};

export const TRAVEL_POSTS: readonly TravelPost[] = [
  {
    id: "dest-my-khe",
    slug: "bai-bien-my-khe",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Bãi biển Mỹ Khê",
    title: "Bãi biển Mỹ Khê: dải cát cho một buổi sáng ở Đà Nẵng",
    excerpt: "Bãi biển chính của thành phố, trải từ chân bán đảo Sơn Trà về phía Ngũ Hành Sơn.",
    cover: "card-my-khe-beach.webp",
    coverAlt: "Bãi biển Mỹ Khê với hàng dừa, Đà Nẵng",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Vì sao nên ghé",
        paragraphs: [
          "Mỹ Khê là bãi biển chính của Đà Nẵng, nằm ngay phía đông thành phố. Các hướng dẫn du lịch mô tả một đường cong cát trắng mịn kéo về phía Ngũ Hành Sơn; từ bán đảo Sơn Trà cũng nhìn thấy bãi biển này ở phía nam.",
          "Nhiều trang du lịch dẫn việc tạp chí Forbes (Mỹ) từng đưa Mỹ Khê vào danh sách các bãi biển quyến rũ nhất hành tinh vào năm 2005. Đó là lời kể lại của các trang du lịch, chúng tôi chưa đối chiếu với bản gốc của Forbes.",
        ],
      },
      {
        heading: "Đi lúc nào",
        paragraphs: [
          "Buổi sáng sớm và cuối chiều thường dễ chịu hơn để đi dạo trên cát. Một số hướng dẫn du lịch nhắc rằng mùa khô ở Đà Nẵng kéo dài từ khoảng tháng 2 đến hết tháng 8, còn từ tháng 10 đến tháng 12 thành phố có thể chịu ảnh hưởng của bão.",
          "Trước khi xuống nước, hãy xem dự báo thời tiết và làm theo hướng dẫn của lực lượng cứu hộ tại bãi biển.",
        ],
      },
      {
        heading: "Một lưu ý về số liệu",
        paragraphs: [
          "Chiều dài của Mỹ Khê được các nguồn nêu rất khác nhau: có nguồn tính cả dải ven biển, có nguồn chỉ tính đoạn đã được khai thác. Vì vậy bài này không đưa con số nào.",
        ],
      },
    ],
    sources: [
      VIETNAM_TOURISM_DANANG,
      {
        label: "My Khe Beach — one of the six most attractive beaches on the planet",
        publisher: "Vinpearl",
        url: "https://vinpearl.com/en/my-khe-beach-one-of-the-six-most-attractive-beaches-on-the-planet",
      },
      {
        label: "My Khe Beach (cẩm nang du lịch)",
        publisher: "Vietnam Airlines",
        url: "https://www.vietnamairlines.com/gb/en/plan-book/travel/travel-guide/my-khe-beach",
      },
    ],
    related: ["ban-dao-son-tra", "cau-rong-song-han", "ngu-hanh-son"],
  },
  {
    id: "dest-son-tra",
    slug: "ban-dao-son-tra",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Bán đảo Sơn Trà",
    title: "Bán đảo Sơn Trà và chùa Linh Ứng: cung đường ven biển phía bắc",
    excerpt: "Đường vòng quanh bán đảo, tượng Quan Thế Âm cao 67 m và một khu bảo tồn thiên nhiên cạnh thành phố.",
    cover: "card-linh-ung-son-tra.webp",
    coverAlt: "Chùa Linh Ứng trên bán đảo Sơn Trà, Đà Nẵng",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Cung đường quanh bán đảo",
        paragraphs: [
          "Vietnam Tourism gợi ý đi chậm qua các khúc cua của bán đảo để ngắm cảnh và, nếu còn thời gian, đi trọn vòng theo đường ven biển. Từ Sơn Trà nhìn thấy bãi Mỹ Khê ở phía nam và đèo Hải Vân ở phía bắc.",
        ],
      },
      {
        heading: "Chùa Linh Ứng",
        paragraphs: [
          "Linh Ứng là một ngôi chùa lớn và là địa danh của Đà Nẵng, thường được ghé khi đi quanh Sơn Trà. Các nguồn đều nêu bức tượng Quan Thế Âm màu trắng ở đây cao 67 m.",
        ],
      },
      {
        heading: "Khu bảo tồn thiên nhiên",
        paragraphs: [
          "Sơn Trà là một khu bảo tồn thiên nhiên và là nơi sinh sống của voọc chà vá chân nâu. Diện tích khu bảo tồn và số cá thể voọc được các nguồn nêu không thống nhất, nên bài này không đưa con số.",
          "Đây là nơi của động vật hoang dã: hãy giữ yên tĩnh và không làm phiền chúng. Cũng như ở bãi biển, một số hướng dẫn nhắc rằng từ tháng 10 đến tháng 12 có thể có bão, nên xem dự báo thời tiết trước khi lên bán đảo.",
        ],
      },
    ],
    sources: [
      VIETNAM_TOURISM_DANANG,
      {
        label: "Hiking Monkey Mountain, Da Nang: the search for Vietnam's most beautiful primate",
        publisher: "South China Morning Post",
        url: "https://www.scmp.com/lifestyle/travel-leisure/article/3358694/hiking-monkey-mountain-da-nang-vietnam-search-most-beautiful-primate",
      },
      {
        label: "Son Tra Peninsula travel guide",
        publisher: "Hoi An Day Trip (công ty lữ hành)",
        url: "https://hoiandaytrip.com/son-tra-peninsula-travel-guide/",
      },
    ],
    related: ["bai-bien-my-khe", "ngu-hanh-son", "cau-rong-song-han"],
  },
  {
    id: "dest-ngu-hanh-son",
    slug: "ngu-hanh-son",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Ngũ Hành Sơn",
    title: "Ngũ Hành Sơn: năm ngọn núi đá vôi, hang động và chùa",
    excerpt: "Cụm núi ở phía nam thành phố, nơi Thủy Sơn là ngọn mở cho khách leo lên.",
    cover: "card-ngu-hanh-son.webp",
    coverAlt: "Nhìn ra bờ biển từ Ngũ Hành Sơn, Đà Nẵng",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Năm ngọn núi",
        paragraphs: [
          "Ngũ Hành Sơn gồm năm ngọn núi đá vôi mang tên năm yếu tố: Kim, Thủy, Mộc, Hỏa và Thổ. Cụm núi nằm ở phía nam trung tâm Đà Nẵng; Vietnam Tourism ghi khoảng bảy km tính từ trung tâm và có thể đi bằng taxi.",
        ],
      },
      {
        heading: "Thủy Sơn",
        paragraphs: [
          "Thủy Sơn là ngọn nổi tiếng nhất, với nhiều hang động có điện thờ Hindu và Phật giáo. Theo Wikipedia, đây là ngọn duy nhất mở cho khách tham quan, với cầu thang 156 bậc dẫn lên đỉnh và tầm nhìn toàn cảnh.",
          "Tấm ảnh của bài này chụp bờ biển nhìn từ trên núi xuống.",
        ],
      },
      {
        heading: "Nghề chạm khắc đá",
        paragraphs: [
          "Khu vực quanh núi nổi tiếng với nghề chạm khắc đá. Một số hướng dẫn du lịch khuyên đến sớm trong ngày để tránh đông; giờ mở cửa và giá vé có thể thay đổi nên hãy xem thông báo mới nhất tại nơi bán vé.",
        ],
      },
    ],
    sources: [
      VIETNAM_TOURISM_DANANG,
      {
        label: "Marble Mountains (Vietnam)",
        publisher: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/Marble_Mountains_(Vietnam)",
      },
    ],
    related: ["bai-bien-my-khe", "ban-dao-son-tra", "pho-co-hoi-an"],
  },
  {
    id: "dest-cau-rong",
    slug: "cau-rong-song-han",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Cầu Rồng và sông Hàn",
    title: "Cầu Rồng và sông Hàn: Đà Nẵng lúc hoàng hôn và về đêm",
    excerpt: "Cây cầu thép dài 666 m bắc qua sông Hàn, thông xe năm 2013, là một biểu tượng của thành phố.",
    cover: "card-cau-rong-song-han.webp",
    coverAlt: "Cầu Rồng bắc qua sông Hàn lúc hoàng hôn, Đà Nẵng",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Cây cầu",
        paragraphs: [
          "Theo Wikipedia, Cầu Rồng khởi công ngày 19/7/2009 và thông xe ngày 29/3/2013. Cầu bằng thép, dài 666 m, rộng 37,5 m, có sáu làn xe.",
        ],
      },
      {
        heading: "Rồng phun lửa và nước",
        paragraphs: [
          "Cầu được thiết kế để phun lửa và nước vào tối thứ Bảy và Chủ nhật lúc 21 giờ. Đó là ý đồ thiết kế ghi trên Wikipedia; chúng tôi không xác nhận được lịch hiện tại, nên hãy kiểm tra thông báo mới nhất của thành phố trước khi đến.",
        ],
      },
      {
        heading: "Sông Hàn",
        paragraphs: [
          "Bờ sông Hàn, gần Cảng sông Hàn, cũng là nơi bắn pháo hoa của Lễ hội pháo hoa quốc tế Đà Nẵng; bản tin về mùa lễ hội năm 2026 nằm ở mục Tin du lịch.",
        ],
      },
    ],
    sources: [
      {
        label: "Dragon Bridge (Da Nang)",
        publisher: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/Dragon_Bridge_(Da_Nang)",
      },
      {
        label: "Lễ hội pháo hoa quốc tế Đà Nẵng DIFF 2026",
        publisher: "Báo điện tử Chính phủ (xaydungchinhsach.chinhphu.vn)",
        url: "https://xaydungchinhsach.chinhphu.vn/lich-thi-dau-le-hoi-phao-hoa-quoc-te-da-nang-diff-2026-11926051511343632.htm",
        publishedAt: "2026-07-12",
      },
    ],
    related: ["bai-bien-my-khe", "ban-dao-son-tra", "diff-2026-khep-lai"],
  },
  {
    id: "dest-hoi-an",
    slug: "pho-co-hoi-an",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Phố cổ Hội An",
    title: "Phố cổ Hội An: di sản thế giới gần Đà Nẵng",
    excerpt: "Thương cảng cổ được UNESCO ghi danh năm 1999, nổi tiếng với những con hẻm, nhà cổ, chùa và đèn lồng.",
    cover: "card-hoi-an.webp",
    coverAlt: "Phố cổ Hội An về đêm với đèn lồng",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Di sản thế giới",
        paragraphs: [
          "Phố cổ Hội An được UNESCO ghi vào Danh sách Di sản thế giới ngày 4/12/1999 theo tiêu chí (ii) và (v): là chứng tích về sự giao thoa văn hoá ở một thương cảng và là một thương cảng truyền thống châu Á được bảo tồn tốt.",
        ],
      },
      {
        heading: "Từ Đà Nẵng đến Hội An",
        paragraphs: [
          "Vietnam Tourism ghi Hội An cách Đà Nẵng khoảng 45 phút đi xe và nổi tiếng với các con hẻm, chùa và nhà phố cổ. Thời gian thực tế tuỳ giao thông và phương tiện.",
        ],
      },
      {
        heading: "Buổi tối và các sự kiện",
        paragraphs: [
          "Buổi tối phố cổ lên đèn lồng, như trong ảnh của bài này. Một số sự kiện dự kiến diễn ra ở đây vào cuối năm 2026; bạn có thể đọc bản tin tổng hợp ở mục Tin du lịch và nhớ rằng lịch có thể thay đổi.",
        ],
      },
    ],
    sources: [
      {
        label: "Hoi An Ancient Town",
        publisher: "UNESCO World Heritage Centre",
        url: "https://whc.unesco.org/en/list/948",
      },
      VIETNAM_TOURISM_DANANG,
    ],
    related: ["co-do-hue", "ngu-hanh-son", "su-kien-cuoi-nam-2026"],
  },
  {
    id: "dest-hue",
    slug: "co-do-hue",
    kind: "destination",
    category: "diem-den-noi-bat",
    shortTitle: "Cố đô Huế",
    title: "Huế: quần thể di tích cố đô ở phía bắc đèo Hải Vân",
    excerpt: "Hoàng thành, Kinh thành và Tử Cấm Thành — quần thể được UNESCO ghi danh năm 1993.",
    cover: "card-hue.webp",
    coverAlt: "Cổng trong Kinh thành Huế",
    publishedAt: UPDATED,
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Quần thể di tích",
        paragraphs: [
          "Quần thể di tích Huế được UNESCO ghi danh năm 1993. Theo Wikipedia, quần thể gồm Hoàng thành, Kinh thành và Tử Cấm Thành, cùng các công trình ngoài thành như lăng tẩm của bảy vị hoàng đế, chùa và đền.",
        ],
      },
      {
        heading: "Cố đô",
        paragraphs: [
          "Huế được chọn làm kinh đô của nước Việt Nam thống nhất năm 1802, dưới thời vua Gia Long.",
        ],
      },
      {
        heading: "Từ Đà Nẵng ra Huế",
        paragraphs: [
          "Huế nằm ở phía bắc đèo Hải Vân, và Vietnam Tourism có bài riêng về hành trình từ Hội An đến Huế qua đèo này. Bài này không nêu thời gian di chuyển, giờ mở cửa hay giá vé vì các thông tin đó thay đổi; hãy xem kênh chính thức của di tích khi lên kế hoạch.",
        ],
      },
    ],
    sources: [
      {
        label: "Complex of Huế Monuments",
        publisher: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/Complex_of_Hu%E1%BA%BF_Monuments",
      },
      VIETNAM_TOURISM_DANANG,
    ],
    related: ["pho-co-hoi-an", "ban-dao-son-tra", "cau-rong-song-han"],
  },
  {
    id: "news-diff-2026",
    slug: "diff-2026-khep-lai",
    kind: "news",
    category: "tin-du-lich",
    title: "Lễ hội pháo hoa quốc tế Đà Nẵng 2026 khép lại sau sáu đêm trình diễn",
    excerpt: "Lễ hội diễn ra từ 30/5 đến 11/7/2026 bên sông Hàn; Sở Văn hoá, Thể thao và Du lịch công bố khoảng 2,72 triệu lượt khách lưu trú trong mùa lễ hội.",
    cover: "card-firework-festival.webp",
    coverAlt: "Khán giả xem pháo hoa tại Lễ hội pháo hoa quốc tế Đà Nẵng",
    publishedAt: "2026-07-12",
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Diễn biến",
        paragraphs: [
          "Theo Báo điện tử Chính phủ, Lễ hội pháo hoa quốc tế Đà Nẵng 2026 diễn ra từ 30/5 đến 11/7/2026 ở khu vực bờ sông Hàn, với sáu đêm trình diễn vào các tối thứ Bảy. Chủ đề các đêm lần lượt là Thiên nhiên, Di sản, Văn hoá, Sáng tạo, Tầm nhìn và, ở đêm chung kết, “Những chân trời kết nối”. Lịch, chủ đề và đội thi của từng đêm được công bố từ trước lễ hội; bài này chỉ dùng những phần bản tin xác nhận đã diễn ra.",
        ],
      },
      {
        heading: "Đêm chung kết",
        paragraphs: [
          "Cũng theo Báo điện tử Chính phủ (12/7/2026), ở đêm chung kết tối 11/7 đội Bồ Đào Nha giành chức vô địch và đội Trung Quốc về nhì; giải “Sáng tạo” thuộc về Ý, giải “Triển vọng” thuộc về Nhật Bản và giải “Khán giả yêu thích nhất” thuộc về đội Đà Nẵng. Kết quả này chúng tôi mới đọc trên một nguồn. Số đội tham dự được bản tin nêu không thống nhất nên bài này không đưa con số.",
        ],
      },
      {
        heading: "Lượng khách lưu trú",
        paragraphs: [
          "Theo Sở Văn hoá, Thể thao và Du lịch Đà Nẵng, được Báo Văn hoá đưa lại, thành phố đón khoảng 2,72 triệu lượt khách lưu trú trong mùa lễ hội (30/5–11/7/2026), tăng gần 45% so với mùa năm 2025. Đây là số liệu do cơ quan quản lý công bố, chưa có đối chiếu độc lập.",
          "Ảnh của bài là ảnh tư liệu về khán giả xem pháo hoa tại lễ hội, không phải một đêm thi cụ thể của năm 2026.",
        ],
      },
    ],
    sources: [
      {
        label: "Lịch thi đấu Lễ hội pháo hoa quốc tế Đà Nẵng DIFF 2026",
        publisher: "Báo điện tử Chính phủ (xaydungchinhsach.chinhphu.vn)",
        url: "https://xaydungchinhsach.chinhphu.vn/lich-thi-dau-le-hoi-phao-hoa-quoc-te-da-nang-diff-2026-11926051511343632.htm",
        publishedAt: "2026-07-12",
      },
      {
        label: "Hơn 2,72 triệu lượt khách đến Đà Nẵng mùa DIFF 2026, khách sạn trung tâm kín phòng",
        publisher: "Báo Văn hoá",
        url: "https://baovanhoa.vn/du-lich/hon-272-trieu-luot-khach-den-da-nang-mua-diff-2026-khach-san-trung-tam-kin-phong-245170.html",
      },
    ],
    related: ["du-lich-da-nang-9-thang-2026", "cau-rong-song-han", "su-kien-cuoi-nam-2026"],
  },
  {
    id: "news-9-thang-2026",
    slug: "du-lich-da-nang-9-thang-2026",
    kind: "news",
    category: "tin-du-lich",
    title: "Du lịch Đà Nẵng 9 tháng đầu năm 2026: gần 15,9 triệu lượt khách lưu trú",
    excerpt: "Theo số liệu thống kê được VietnamPlus đưa ngày 5/10/2026, lượng khách lưu trú tăng 26,4% so với cùng kỳ.",
    cover: "card-danang-skyline.webp",
    coverAlt: "Đường chân trời Đà Nẵng lúc chạng vạng",
    publishedAt: "2026-10-05",
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Lượt khách",
        paragraphs: [
          "VietnamPlus, dẫn thống kê của TTXVN, cho biết các cơ sở lưu trú ở Đà Nẵng phục vụ khoảng 15,86 triệu lượt khách trong chín tháng đầu năm 2026, tăng 26,4% so với cùng kỳ.",
        ],
        bullets: [
          "Khách quốc tế: khoảng 7,73 triệu lượt, tăng 28,7%.",
          "Khách trong nước: khoảng 8,13 triệu lượt, tăng 24,3%.",
        ],
      },
      {
        heading: "Doanh thu",
        paragraphs: [
          "Doanh thu dịch vụ lưu trú và ăn uống đạt khoảng 52.945 tỷ đồng, tăng 26,2%; trong đó lưu trú khoảng 16.939 tỷ đồng (tăng 23,9%) và ăn uống khoảng 36.006 tỷ đồng (tăng 27,3%). Doanh thu dịch vụ lữ hành khoảng 4.028 tỷ đồng, tăng 16,5%.",
        ],
      },
      {
        heading: "Cách đọc con số",
        paragraphs: [
          "Đây là thống kê của thành phố về toàn bộ cơ sở lưu trú, không phải thông tin về phòng trống hay giá của The BHA. Tình trạng phòng và giá thật được hệ thống đặt phòng cho biết theo ngày bạn chọn.",
        ],
      },
    ],
    sources: [
      {
        label: "Du lịch Đà Nẵng 9 tháng 2026: Tăng trưởng ấn tượng với hơn 15,86 triệu lượt khách",
        publisher: "VietnamPlus",
        url: "https://www.vietnamplus.vn/da-nang-don-gan-16-trieu-luot-khach-luu-tru-trong-9-thang-nam-2026-post1140183.vnp",
        publishedAt: "2026-10-05",
      },
    ],
    related: ["diff-2026-khep-lai", "su-kien-cuoi-nam-2026", "bai-bien-my-khe"],
  },
  {
    id: "news-su-kien-cuoi-nam-2026",
    slug: "su-kien-cuoi-nam-2026",
    kind: "news",
    category: "tin-du-lich",
    title: "Lịch sự kiện cuối năm 2026 ở Đà Nẵng và Hội An (dự kiến)",
    excerpt: "Ngày Di sản Văn hoá tại phố cổ Hội An, Lễ hội Đèn lồng quốc tế và các hoạt động dịp Giáng sinh — tất cả theo lịch đã công bố và có thể thay đổi.",
    cover: "card-hoi-an.webp",
    coverAlt: "Phố cổ Hội An về đêm với đèn lồng",
    publishedAt: "2026-09-05",
    updatedAt: UPDATED,
    sections: [
      {
        heading: "Theo bản tin của Báo Văn hoá (5/9/2026)",
        paragraphs: [
          "Các sự kiện dưới đây là kế hoạch được báo đưa tin vào đầu tháng 9; chúng chưa diễn ra vào thời điểm đó.",
        ],
        bullets: [
          "Ngày Di sản Văn hoá Việt Nam tại khu phố cổ Hội An, từ 23/11 đến 7/12/2026: triển lãm, giải chạy việt dã, biểu diễn Bài chòi và miễn vé tham quan phố cổ.",
          "Lễ hội Đèn lồng quốc tế Đà Nẵng 2026, từ 3 đến 6/12/2026 tại các phường Hội An, Hội An Đông và Hội An Tây. Một danh mục sự kiện khác từng ghi lễ hội này vào ngày 21–25/1, nên hãy chờ thông báo chính thức trước khi đặt lịch.",
          "Lễ hội Chào năm mới Đà Nẵng 2027, dự kiến từ tháng 12/2026 đến tháng 1/2027 tại các quảng trường, không gian cảnh quan, phố đi bộ và bãi biển.",
        ],
      },
      {
        heading: "Theo danh mục sự kiện của Danang FantastiCity",
        paragraphs: [
          "Trang này đăng ngày 1/12/2025 và ghi toàn bộ bảng sự kiện là “thời gian dự kiến”, “thông tin có thể thay đổi tuỳ tình hình thực tế”.",
        ],
        bullets: [
          "Chợ Giáng sinh Đà Nẵng 2026: 4–6/12/2026 tại Ariyana Convention Centre Đà Nẵng.",
          "Lễ Giáng sinh – Noel 2026: 24–25/12/2026 tại khu phố cổ Hội An.",
        ],
      },
      {
        heading: "Trước khi lên kế hoạch",
        paragraphs: [
          "Đây không phải sự kiện do The BHA tổ chức. Hãy kiểm tra thông báo mới nhất của ban tổ chức trước khi đặt chỗ ở hoặc vé.",
        ],
      },
    ],
    sources: [
      {
        label: "Đà Nẵng: Nhiều sự kiện, lễ hội thu hút du khách dịp cuối năm",
        publisher: "Báo Văn hoá",
        url: "https://baovanhoa.vn/du-lich/da-nang-nhieu-su-kien-le-hoi-thu-hut-du-khach-dip-cuoi-nam-262190.html",
        publishedAt: "2026-09-05",
      },
      {
        label: "Danh mục sự kiện và lễ hội Đà Nẵng năm 2026",
        publisher: "Danang FantastiCity",
        url: "https://danangfantasticity.com/kham-pha/danh-muc-su-kien-va-le-hoi-da-nang-nam-2026",
        publishedAt: "2025-12-01",
      },
    ],
    related: ["pho-co-hoi-an", "diff-2026-khep-lai", "du-lich-da-nang-9-thang-2026"],
  },
];
