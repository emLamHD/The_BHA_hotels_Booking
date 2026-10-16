/**
 * CUST-WEB-001-CP08a-C2: the licensed photographs of the booking-portal home page, with the credit each
 * licence asks for, and the hero slides built from them.
 *
 * Every record mirrors `scripts/homepage-media/manifest.json` (written by `build_media.py` from the file's own
 * Wikimedia Commons page: author, licence, licence URL, original checksum). `heroSlides.test.ts` reads that
 * manifest and fails when a record here, or a `.webp` under `public/media/the-bha-travel/`, does not match it.
 * The photographs show Đà Nẵng and the places around it; they are not pictures of The BHA Riverside's rooms or
 * of the view from them, and no text here says so.
 */

export const TRAVEL_MEDIA_URL_PATH = "/media/the-bha-travel/";
export const MEDIA_CREDITS_PATH = "/media-credits";

export interface MediaCredit {
  /** The manifest entry's id. */
  id: string;
  /** The file's page title on Wikimedia Commons. */
  commonsTitle: string;
  /** The author exactly as the Commons page gives it. */
  author: string;
  license: "CC0" | "CC BY 2.0" | "CC BY 4.0" | "CC BY-SA 2.0" | "CC BY-SA 4.0";
  licenseUrl: string;
  sourceUrl: string;
  /** Files published from this original (under `public/media/the-bha-travel/`). */
  files: readonly string[];
}

const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/deed.en";
const CC_BY_2 = "https://creativecommons.org/licenses/by/2.0";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0";
const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0";

/** What was done to every original; CC BY and CC BY-SA ask that changes are indicated. */

export const MEDIA_CREDITS: readonly MediaCredit[] = [
  {
    id: "dragon-bridge-dusk",
    commonsTitle: "File:Da Nang, Vietnam.jpg",
    author: "Quangpraha",
    license: "CC0",
    licenseUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Da_Nang,_Vietnam.jpg",
    files: ["hero-dragon-bridge-dusk.webp", "card-cau-rong-song-han.webp"],
  },
  {
    id: "danang-skyline-night",
    commonsTitle: "File:Bright Da Nang skyline (Unsplash).jpg",
    author: "NGO TUNG thanhtungo",
    license: "CC0",
    licenseUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Bright_Da_Nang_skyline_(Unsplash).jpg",
    files: ["hero-danang-skyline.webp", "card-danang-skyline.webp"],
  },
  {
    id: "han-river-bridge-night",
    commonsTitle: "File:Da Nang - DaNang1492.jpg",
    author: "lumoplank",
    license: "CC0",
    licenseUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Da_Nang_-_DaNang1492.jpg",
    files: ["hero-han-river-night.webp"],
  },
  {
    id: "my-khe-beach",
    commonsTitle: "File:My Khe Beach, Da Nang, Vietnam.jpg",
    author: ". Ray in Manila",
    license: "CC BY 2.0",
    licenseUrl: CC_BY_2,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:My_Khe_Beach,_Da_Nang,_Vietnam.jpg",
    files: ["hero-my-khe-beach.webp", "card-my-khe-beach.webp"],
  },
  {
    id: "linh-ung-pagoda",
    commonsTitle: "File:Chùa Linh Ứng Buddhist Temple, Danang, Vietnam (54161781835).jpg",
    author: "Mustang Joe",
    license: "CC0",
    licenseUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Chùa_Linh_Ứng_Buddhist_Temple,_Danang,_Vietnam_(54161781835).jpg",
    files: ["card-linh-ung-son-tra.webp"],
  },
  {
    id: "marble-mountains-view",
    commonsTitle: "File:Da Nang - coastal view from Marble Mountains Mar 2024 01.jpg",
    author: "Dominic Nelson",
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Da_Nang_-_coastal_view_from_Marble_Mountains_Mar_2024_01.jpg",
    files: ["card-ngu-hanh-son.webp"],
  },
  {
    id: "hoi-an-old-town-night",
    commonsTitle: "File:2024-12-20 Hoi An Old Town at night 4.jpg",
    author: "Alexkom000",
    license: "CC BY 4.0",
    licenseUrl: CC_BY_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:2024-12-20_Hoi_An_Old_Town_at_night_4.jpg",
    files: ["card-hoi-an.webp"],
  },
  {
    id: "hue-citadel-gate",
    commonsTitle: "File:Gate in the Citadel of Huế.jpg",
    author: "Christophe95",
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Gate_in_the_Citadel_of_Huế.jpg",
    files: ["card-hue.webp"],
  },
  {
    id: "danang-fireworks",
    commonsTitle: "File:Audience impressed by Danang International Firework Festival.jpg",
    author: "Vivu Vietnam",
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Audience_impressed_by_Danang_International_Firework_Festival.jpg",
    files: ["card-firework-festival.webp"],
  },
];

export const travelMediaUrl = (file: string) => `${TRAVEL_MEDIA_URL_PATH}${file}`;

/** The credit of the original a published file was made from, or undefined for a file no record names. */
export function creditForFile(file: string): MediaCredit | undefined {
  return MEDIA_CREDITS.find((credit) => credit.files.indexOf(file) !== -1);
}

/** One line for a caption: "<photo label>: <author> · <licence>" (the label is the visitor's language). The credits page carries the links. */
export function creditLine(credit: MediaCredit, photoLabel: string): string {
  return `${photoLabel}: ${credit.author.replace(/^\.\s*/, "")} · ${credit.license}`;
}

export interface HeroSlide {
  id: string;
  file: string;
  alt: string;
  /** Short caption naming the place shown (not a claim about the property or its rooms). */
  caption: string;
  /** CSS `object-position` for narrow screens, where the 1920×900 picture is cropped to a taller frame. */
  mobilePosition: string;
}

export const HERO_WIDTH = 1920;
export const HERO_HEIGHT = 900;

/** The first slide is the lightest file; it is the only one loaded with priority. */
export const HERO_SLIDES: readonly HeroSlide[] = [
  {
    id: "dragon-bridge-dusk",
    file: "hero-dragon-bridge-dusk.webp",
    alt: "Cầu Rồng và sông Hàn lúc hoàng hôn, Đà Nẵng",
    caption: "Cầu Rồng và sông Hàn lúc hoàng hôn",
    mobilePosition: "40% 50%",
  },
  {
    id: "my-khe-beach",
    file: "hero-my-khe-beach.webp",
    alt: "Bãi biển Mỹ Khê với hàng dừa, Đà Nẵng",
    caption: "Bãi biển Mỹ Khê",
    mobilePosition: "50% 50%",
  },
  {
    id: "danang-skyline-night",
    file: "hero-danang-skyline.webp",
    alt: "Đường chân trời Đà Nẵng lúc chạng vạng",
    caption: "Đường chân trời Đà Nẵng lúc chạng vạng",
    mobilePosition: "50% 50%",
  },
  {
    id: "han-river-bridge-night",
    file: "hero-han-river-night.webp",
    alt: "Cầu quay sông Hàn về đêm, Đà Nẵng",
    caption: "Sông Hàn về đêm",
    mobilePosition: "60% 50%",
  },
];
