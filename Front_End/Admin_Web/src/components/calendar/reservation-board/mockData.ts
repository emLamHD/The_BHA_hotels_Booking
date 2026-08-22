/**
 * Deterministic typed mock data for the Reservation Board UI baseline
 * (ADMIN-002.1). This board is not connected to any backend — every value
 * here is fixed and fictional. Do not treat as authoritative PMS state.
 */

import { DEMO_ACTOR } from "./types";
import type {
  BookingSource,
  GuestNationality,
  PhysicalRoom,
  Property,
  ReservationActivityEntry,
  ReservationFolioEntry,
  RoomType,
  TimelineItem,
} from "./types";

/** Fixed demo property check-in/checkout times, applied uniformly to every mock reservation. */
const DEFAULT_CHECK_IN_TIME = "14:00";
const DEFAULT_CHECK_OUT_TIME = "12:00";

/** Fixed demo "today" anchor. Never derived from the runtime clock. */
export const DEMO_TODAY_ISO = "2026-08-19";

export const MOCK_PROPERTIES: Property[] = [
  { id: "bha-house", name: "The BHA House" },
  { id: "bha-riverside", name: "The BHA Riverside" },
];

export const MOCK_ROOM_TYPES: RoomType[] = [
  { id: "rt-house-deluxe", propertyId: "bha-house", name: "Deluxe Room" },
  { id: "rt-house-suite", propertyId: "bha-house", name: "Suite" },
  { id: "rt-riverside-standard", propertyId: "bha-riverside", name: "Standard Room" },
  { id: "rt-riverside-family", propertyId: "bha-riverside", name: "Family Room" },
];

export const MOCK_PHYSICAL_ROOMS: PhysicalRoom[] = [
  { id: "room-101", roomTypeId: "rt-house-deluxe", code: "101" },
  { id: "room-102", roomTypeId: "rt-house-deluxe", code: "102" },
  { id: "room-201", roomTypeId: "rt-house-suite", code: "201" },
  { id: "room-202", roomTypeId: "rt-house-suite", code: "202" },
  { id: "room-301", roomTypeId: "rt-riverside-standard", code: "301" },
  { id: "room-302", roomTypeId: "rt-riverside-standard", code: "302" },
  { id: "room-401", roomTypeId: "rt-riverside-family", code: "401" },
  { id: "room-402", roomTypeId: "rt-riverside-family", code: "402" },
];

/** Compact in-app text marks — never third-party logo assets or pixel-for-pixel trademarks. */
export const MOCK_BOOKING_SOURCES: BookingSource[] = [
  {
    id: "direct",
    label: "Direct",
    markLabel: "BHA",
    markClassName: "bg-brand-500 text-white",
  },
  {
    id: "booking_com",
    label: "Booking.com",
    markLabel: "B",
    markClassName: "bg-blue-700 text-white",
  },
  {
    id: "agoda",
    label: "Agoda",
    markLabel: "A",
    markClassName: "bg-purple-700 text-white",
  },
];

const NATIONALITY_VIETNAM: GuestNationality = { code: "VN", label: "Vietnam", flag: "🇻🇳" };
const NATIONALITY_BRAZIL: GuestNationality = { code: "BR", label: "Brazil", flag: "🇧🇷" };
const NATIONALITY_JAPAN: GuestNationality = { code: "JP", label: "Japan", flag: "🇯🇵" };
const NATIONALITY_JORDAN: GuestNationality = { code: "JO", label: "Jordan", flag: "🇯🇴" };
const NATIONALITY_SOUTH_KOREA: GuestNationality = { code: "KR", label: "South Korea", flag: "🇰🇷" };
const NATIONALITY_MEXICO: GuestNationality = { code: "MX", label: "Mexico", flag: "🇲🇽" };
const NATIONALITY_THAILAND: GuestNationality = { code: "TH", label: "Thailand", flag: "🇹🇭" };
const NATIONALITY_UK: GuestNationality = { code: "GB", label: "United Kingdom", flag: "🇬🇧" };
const NATIONALITY_US: GuestNationality = { code: "US", label: "United States", flag: "🇺🇸" };
const NATIONALITY_FRANCE: GuestNationality = { code: "FR", label: "France", flag: "🇫🇷" };
const NATIONALITY_AUSTRALIA: GuestNationality = { code: "AU", label: "Australia", flag: "🇦🇺" };

/** Reservation Board's own nationality option list — the create-reservation feature owns a separate list for its own workflow (see that feature's mockData.ts). */
export const MOCK_NATIONALITIES: GuestNationality[] = [
  NATIONALITY_VIETNAM,
  NATIONALITY_US,
  NATIONALITY_UK,
  NATIONALITY_JAPAN,
  NATIONALITY_SOUTH_KOREA,
  NATIONALITY_BRAZIL,
  NATIONALITY_JORDAN,
  NATIONALITY_MEXICO,
  NATIONALITY_THAILAND,
  NATIONALITY_FRANCE,
  NATIONALITY_AUSTRALIA,
];

/**
 * Reservation Board's own simple reference nightly rate per RoomType — a
 * plain demo number, intentionally independent of the create-reservation
 * feature's `RatePlan` mock data (that feature owns its own pricing model).
 */
const NIGHTLY_RATE_BY_ROOM_TYPE: Record<string, number> = {
  "rt-house-deluxe": 1_200_000,
  "rt-house-suite": 2_500_000,
  "rt-riverside-standard": 900_000,
  "rt-riverside-family": 1_800_000,
};

/** Every seed activity/folio entry shares this baseline demo-clock instant ("loaded this morning"). */
const BASELINE_CLOCK_MINUTES = 9 * 60;

function seedCreatedActivity(itemId: string): ReservationActivityEntry[] {
  return [
    {
      id: `${itemId}-act-0`,
      type: "created",
      description: "Reservation created (mock baseline).",
      actor: DEMO_ACTOR,
      clockMinutes: BASELINE_CLOCK_MINUTES,
    },
  ];
}

function seedCollectionEntry(
  itemId: string,
  kind: "deposit" | "payment",
  amount: number
): ReservationFolioEntry[] {
  return [
    {
      id: `${itemId}-folio-0`,
      kind,
      amount,
      currency: "VND",
      method: "bank-transfer",
      actor: DEMO_ACTOR,
      clockMinutes: BASELINE_CLOCK_MINUTES,
    },
  ];
}

/**
 * Timeline items across both properties. Deliberately covers: short and
 * long reservations, all three booking sources, multiple nationalities,
 * adult-only and with-children occupancy, every lifecycle status reachable
 * without a live action (pending/confirmed/checked-in/checked-out — see
 * §6), every derived folio status (unpaid/partial/paid), at least one
 * unassigned reservation, at least one operational block, an item clipped
 * at the beginning of the initial 14-day visible range, an item clipped at
 * the end of it, and a one-night reservation.
 */
export const MOCK_TIMELINE_ITEMS: TimelineItem[] = [
  // The BHA House — Room 101 (Deluxe): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-101-a",
    propertyId: "bha-house",
    roomId: "room-101",
    soldRoomTypeId: "rt-house-deluxe",
    reservationCode: "BHA-2026-1001",
    guestName: "Nguyen Minh Anh",
    guestPhone: "090 123 4501",
    guestEmail: "minhanh.nguyen@example.com",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-15",
    endDate: "2026-08-21",
    occupancy: { adults: 2, children: 0 },
    lifecycleStatus: "checked-in",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: BASELINE_CLOCK_MINUTES,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-deluxe"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-house-101-a", "payment", 7_200_000),
    notes: [],
    activity: seedCreatedActivity("res-house-101-a"),
  },
  {
    kind: "assigned-reservation",
    id: "res-house-101-b",
    propertyId: "bha-house",
    roomId: "room-101",
    soldRoomTypeId: "rt-house-deluxe",
    reservationCode: "BHA-2026-1002",
    guestName: "Tran Bao Long",
    guestPhone: "090 123 4502",
    guestEmail: "",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "booking_com",
    startDate: "2026-08-21",
    endDate: "2026-08-24",
    occupancy: { adults: 1, children: 0 },
    // Deliberately seeded "pending" — an OTA booking awaiting front-desk confirmation (§6).
    lifecycleStatus: "pending",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-deluxe"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-house-101-b", "deposit", 1_500_000),
    notes: [],
    activity: seedCreatedActivity("res-house-101-b"),
  },

  // The BHA House — Room 102 (Deluxe): one-night stay, then a long stay.
  {
    kind: "assigned-reservation",
    id: "res-house-102-a",
    propertyId: "bha-house",
    roomId: "room-102",
    soldRoomTypeId: "rt-house-deluxe",
    reservationCode: "BHA-2026-1003",
    guestName: "Le Thi Hoa",
    guestPhone: "090 123 4503",
    guestEmail: "lethihoa@example.com",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "agoda",
    startDate: "2026-08-20",
    endDate: "2026-08-21",
    occupancy: { adults: 1, children: 0 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-deluxe"],
    actualNightlyAmount: "",
    folio: [],
    notes: [],
    activity: seedCreatedActivity("res-house-102-a"),
  },
  {
    kind: "assigned-reservation",
    id: "res-house-102-b",
    propertyId: "bha-house",
    roomId: "room-102",
    soldRoomTypeId: "rt-house-deluxe",
    reservationCode: "BHA-2026-1004",
    guestName: "Pham Quoc Bao",
    guestPhone: "090 123 4504",
    guestEmail: "",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-24",
    endDate: "2026-08-31",
    occupancy: { adults: 2, children: 1 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-deluxe"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-house-102-b", "deposit", 2_800_000),
    notes: [],
    activity: seedCreatedActivity("res-house-102-b"),
  },

  // The BHA House — Room 201 (Suite): operational block, then a reservation.
  {
    kind: "operational-block",
    id: "block-house-201-a",
    propertyId: "bha-house",
    roomId: "room-201",
    reason: "Maintenance — AC repair",
    startDate: "2026-08-19",
    endDate: "2026-08-22",
    removed: false,
    activity: [],
  },
  {
    kind: "assigned-reservation",
    id: "res-house-201-a",
    propertyId: "bha-house",
    roomId: "room-201",
    soldRoomTypeId: "rt-house-suite",
    reservationCode: "BHA-2026-1005",
    guestName: "Carlos Mendes",
    guestPhone: "+55 11 98765 4321",
    guestEmail: "carlos.mendes@example.com",
    nationality: NATIONALITY_BRAZIL,
    sourceId: "booking_com",
    startDate: "2026-08-22",
    endDate: "2026-08-26",
    occupancy: { adults: 2, children: 0 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-suite"],
    actualNightlyAmount: "",
    folio: [],
    notes: [],
    activity: seedCreatedActivity("res-house-201-a"),
  },

  // The BHA House — Room 202 (Suite): clipped at the end of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-202-a",
    propertyId: "bha-house",
    roomId: "room-202",
    soldRoomTypeId: "rt-house-suite",
    reservationCode: "BHA-2026-1006",
    guestName: "Yuki Tanaka",
    guestPhone: "+81 90 1234 5678",
    guestEmail: "yuki.tanaka@example.com",
    nationality: NATIONALITY_JAPAN,
    sourceId: "agoda",
    startDate: "2026-08-30",
    endDate: "2026-09-05",
    occupancy: { adults: 1, children: 0 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-suite"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-house-202-a", "payment", 15_000_000),
    notes: [],
    activity: seedCreatedActivity("res-house-202-a"),
  },

  // The BHA House — Suite room type: unassigned reservation.
  {
    kind: "unassigned-reservation",
    id: "unassigned-house-suite-a",
    propertyId: "bha-house",
    soldRoomTypeId: "rt-house-suite",
    reservationCode: "BHA-2026-1007",
    guestName: "Walk-in Family Group",
    guestPhone: "090 123 4507",
    guestEmail: "",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-21",
    endDate: "2026-08-23",
    occupancy: { adults: 2, children: 2 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-house-suite"],
    actualNightlyAmount: "",
    folio: [],
    notes: [],
    activity: seedCreatedActivity("unassigned-house-suite-a"),
  },

  // The BHA Riverside — Room 301 (Standard): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-riverside-301-a",
    propertyId: "bha-riverside",
    roomId: "room-301",
    soldRoomTypeId: "rt-riverside-standard",
    reservationCode: "BHA-2026-2001",
    guestName: "Mohammed Al-Farsi",
    guestPhone: "+962 79 123 4567",
    guestEmail: "m.alfarsi@example.com",
    nationality: NATIONALITY_JORDAN,
    sourceId: "booking_com",
    startDate: "2026-08-18",
    endDate: "2026-08-23",
    occupancy: { adults: 2, children: 0 },
    lifecycleStatus: "checked-in",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: BASELINE_CLOCK_MINUTES,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-riverside-standard"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-riverside-301-a", "payment", 4_500_000),
    notes: [],
    activity: seedCreatedActivity("res-riverside-301-a"),
  },

  // The BHA Riverside — Room 302 (Standard): a completed past stay, then a short upcoming reservation.
  // Demonstrates the "checked-out" lifecycle status and a past-dated item
  // reachable via Previous navigation (ADMIN-002.1-C5 §7).
  {
    kind: "assigned-reservation",
    id: "res-riverside-302-b",
    propertyId: "bha-riverside",
    roomId: "room-302",
    soldRoomTypeId: "rt-riverside-standard",
    reservationCode: "BHA-2026-2002",
    guestName: "Emma Whitfield",
    guestPhone: "+44 7700 900123",
    guestEmail: "emma.whitfield@example.com",
    nationality: NATIONALITY_UK,
    sourceId: "direct",
    startDate: "2026-08-10",
    endDate: "2026-08-14",
    occupancy: { adults: 1, children: 0 },
    lifecycleStatus: "checked-out",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: BASELINE_CLOCK_MINUTES,
    actualCheckOutAt: BASELINE_CLOCK_MINUTES,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-riverside-standard"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-riverside-302-b", "payment", 3_600_000),
    notes: [],
    activity: seedCreatedActivity("res-riverside-302-b"),
  },
  {
    kind: "assigned-reservation",
    id: "res-riverside-302-a",
    propertyId: "bha-riverside",
    roomId: "room-302",
    soldRoomTypeId: "rt-riverside-standard",
    reservationCode: "BHA-2026-2003",
    guestName: "Sara Kim",
    guestPhone: "+82 10 2345 6789",
    guestEmail: "",
    nationality: NATIONALITY_SOUTH_KOREA,
    sourceId: "agoda",
    startDate: "2026-08-25",
    endDate: "2026-08-27",
    occupancy: { adults: 1, children: 0 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-riverside-standard"],
    actualNightlyAmount: "",
    folio: seedCollectionEntry("res-riverside-302-a", "deposit", 900_000),
    notes: [],
    activity: seedCreatedActivity("res-riverside-302-a"),
  },

  // The BHA Riverside — Room 401 (Family): long reservation.
  {
    kind: "assigned-reservation",
    id: "res-riverside-401-a",
    propertyId: "bha-riverside",
    roomId: "room-401",
    soldRoomTypeId: "rt-riverside-family",
    reservationCode: "BHA-2026-2004",
    guestName: "The Rodriguez Family",
    guestPhone: "+52 55 1234 5678",
    guestEmail: "rodriguez.family@example.com",
    nationality: NATIONALITY_MEXICO,
    sourceId: "direct",
    startDate: "2026-08-20",
    endDate: "2026-08-28",
    occupancy: { adults: 2, children: 2 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-riverside-family"],
    actualNightlyAmount: "",
    folio: [],
    notes: [],
    activity: seedCreatedActivity("res-riverside-401-a"),
  },

  // The BHA Riverside — Room 402 (Family): operational block.
  {
    kind: "operational-block",
    id: "block-riverside-402-a",
    propertyId: "bha-riverside",
    roomId: "room-402",
    reason: "Deep cleaning",
    startDate: "2026-08-24",
    endDate: "2026-08-25",
    removed: false,
    activity: [],
  },

  // The BHA Riverside — Family room type: unassigned reservation, clipped at the end.
  {
    kind: "unassigned-reservation",
    id: "unassigned-riverside-family-a",
    propertyId: "bha-riverside",
    soldRoomTypeId: "rt-riverside-family",
    reservationCode: "BHA-2026-2005",
    guestName: "Unassigned OTA Group",
    guestPhone: "+66 81 234 5678",
    guestEmail: "",
    nationality: NATIONALITY_THAILAND,
    sourceId: "booking_com",
    startDate: "2026-08-28",
    endDate: "2026-09-04",
    occupancy: { adults: 3, children: 1 },
    lifecycleStatus: "confirmed",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    nightlyRate: NIGHTLY_RATE_BY_ROOM_TYPE["rt-riverside-family"],
    actualNightlyAmount: "",
    folio: [],
    notes: [],
    activity: seedCreatedActivity("unassigned-riverside-family-a"),
  },
];
