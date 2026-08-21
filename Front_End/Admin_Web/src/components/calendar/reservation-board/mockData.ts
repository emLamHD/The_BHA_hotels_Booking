/**
 * Deterministic typed mock data for the Reservation Board UI baseline
 * (ADMIN-002.1). This board is not connected to any backend — every value
 * here is fixed and fictional. Do not treat as authoritative PMS state.
 */

import type {
  BookingSource,
  GuestNationality,
  PhysicalRoom,
  Property,
  RoomType,
  TimelineItem,
} from "./types";

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

/**
 * Timeline items across both properties. Deliberately covers: short and
 * long reservations, all three booking sources, multiple nationalities,
 * adult-only and with-children occupancy, all three payment display states
 * (including a positive-due Unpaid, a positive-due Deposit, and a
 * zero-due Paid reservation), at least one unassigned reservation, at
 * least one operational block, an item clipped at the beginning of the
 * initial 14-day visible range (2026-08-19 → 2026-09-02), an item clipped
 * at the end of it, and a one-night reservation.
 */
export const MOCK_TIMELINE_ITEMS: TimelineItem[] = [
  // The BHA House — Room 101 (Deluxe): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-101-a",
    propertyId: "bha-house",
    roomId: "room-101",
    soldRoomTypeId: "rt-house-deluxe",
    guestName: "Nguyen Minh Anh",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-15",
    endDate: "2026-08-21",
    occupancy: { adults: 2, children: 0 },
    paymentDisplay: { status: "paid", amountDue: 0, currency: "VND" },
  },
  {
    kind: "assigned-reservation",
    id: "res-house-101-b",
    propertyId: "bha-house",
    roomId: "room-101",
    soldRoomTypeId: "rt-house-deluxe",
    guestName: "Tran Bao Long",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "booking_com",
    startDate: "2026-08-21",
    endDate: "2026-08-24",
    occupancy: { adults: 1, children: 0 },
    paymentDisplay: { status: "deposit", amountDue: 2_100_000, currency: "VND" },
  },

  // The BHA House — Room 102 (Deluxe): one-night stay, then a long stay.
  {
    kind: "assigned-reservation",
    id: "res-house-102-a",
    propertyId: "bha-house",
    roomId: "room-102",
    soldRoomTypeId: "rt-house-deluxe",
    guestName: "Le Thi Hoa",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "agoda",
    startDate: "2026-08-20",
    endDate: "2026-08-21",
    occupancy: { adults: 1, children: 0 },
    paymentDisplay: { status: "unpaid", amountDue: 1_200_000, currency: "VND" },
  },
  {
    kind: "assigned-reservation",
    id: "res-house-102-b",
    propertyId: "bha-house",
    roomId: "room-102",
    soldRoomTypeId: "rt-house-deluxe",
    guestName: "Pham Quoc Bao",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-24",
    endDate: "2026-08-31",
    occupancy: { adults: 2, children: 1 },
    paymentDisplay: { status: "deposit", amountDue: 5_600_000, currency: "VND" },
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
  },
  {
    kind: "assigned-reservation",
    id: "res-house-201-a",
    propertyId: "bha-house",
    roomId: "room-201",
    soldRoomTypeId: "rt-house-suite",
    guestName: "Carlos Mendes",
    nationality: NATIONALITY_BRAZIL,
    sourceId: "booking_com",
    startDate: "2026-08-22",
    endDate: "2026-08-26",
    occupancy: { adults: 2, children: 0 },
    paymentDisplay: { status: "unpaid", amountDue: 9_800_000, currency: "VND" },
  },

  // The BHA House — Room 202 (Suite): clipped at the end of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-202-a",
    propertyId: "bha-house",
    roomId: "room-202",
    soldRoomTypeId: "rt-house-suite",
    guestName: "Yuki Tanaka",
    nationality: NATIONALITY_JAPAN,
    sourceId: "agoda",
    startDate: "2026-08-30",
    endDate: "2026-09-05",
    occupancy: { adults: 1, children: 0 },
    paymentDisplay: { status: "paid", amountDue: 0, currency: "VND" },
  },

  // The BHA House — Suite room type: unassigned reservation.
  {
    kind: "unassigned-reservation",
    id: "unassigned-house-suite-a",
    propertyId: "bha-house",
    soldRoomTypeId: "rt-house-suite",
    guestName: "Walk-in Family Group",
    nationality: NATIONALITY_VIETNAM,
    sourceId: "direct",
    startDate: "2026-08-21",
    endDate: "2026-08-23",
    occupancy: { adults: 2, children: 2 },
    paymentDisplay: { status: "unpaid", amountDue: 4_200_000, currency: "VND" },
  },

  // The BHA Riverside — Room 301 (Standard): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-riverside-301-a",
    propertyId: "bha-riverside",
    roomId: "room-301",
    soldRoomTypeId: "rt-riverside-standard",
    guestName: "Mohammed Al-Farsi",
    nationality: NATIONALITY_JORDAN,
    sourceId: "booking_com",
    startDate: "2026-08-18",
    endDate: "2026-08-23",
    occupancy: { adults: 2, children: 0 },
    paymentDisplay: { status: "paid", amountDue: 0, currency: "VND" },
  },

  // The BHA Riverside — Room 302 (Standard): short reservation.
  {
    kind: "assigned-reservation",
    id: "res-riverside-302-a",
    propertyId: "bha-riverside",
    roomId: "room-302",
    soldRoomTypeId: "rt-riverside-standard",
    guestName: "Sara Kim",
    nationality: NATIONALITY_SOUTH_KOREA,
    sourceId: "agoda",
    startDate: "2026-08-25",
    endDate: "2026-08-27",
    occupancy: { adults: 1, children: 0 },
    paymentDisplay: { status: "deposit", amountDue: 900_000, currency: "VND" },
  },

  // The BHA Riverside — Room 401 (Family): long reservation.
  {
    kind: "assigned-reservation",
    id: "res-riverside-401-a",
    propertyId: "bha-riverside",
    roomId: "room-401",
    soldRoomTypeId: "rt-riverside-family",
    guestName: "The Rodriguez Family",
    nationality: NATIONALITY_MEXICO,
    sourceId: "direct",
    startDate: "2026-08-20",
    endDate: "2026-08-28",
    occupancy: { adults: 2, children: 2 },
    paymentDisplay: { status: "unpaid", amountDue: 13_590_000, currency: "VND" },
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
  },

  // The BHA Riverside — Family room type: unassigned reservation, clipped at the end.
  {
    kind: "unassigned-reservation",
    id: "unassigned-riverside-family-a",
    propertyId: "bha-riverside",
    soldRoomTypeId: "rt-riverside-family",
    guestName: "Unassigned OTA Group",
    nationality: NATIONALITY_THAILAND,
    sourceId: "booking_com",
    startDate: "2026-08-28",
    endDate: "2026-09-04",
    occupancy: { adults: 3, children: 1 },
    paymentDisplay: { status: "unpaid", amountDue: 7_000_000, currency: "VND" },
  },
];
