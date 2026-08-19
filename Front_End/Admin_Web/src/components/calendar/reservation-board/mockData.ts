/**
 * Deterministic typed mock data for the Reservation Board UI baseline
 * (ADMIN-002.1). This board is not connected to any backend — every value
 * here is fixed and fictional. Do not treat as authoritative PMS state.
 */

import type {
  BookingSource,
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

export const MOCK_BOOKING_SOURCES: BookingSource[] = [
  { id: "direct", label: "Direct" },
  { id: "booking_com", label: "Booking.com" },
  { id: "agoda", label: "Agoda" },
];

/**
 * Timeline items across both properties. Deliberately covers: short and
 * long reservations, all three booking sources, at least one unassigned
 * reservation, at least one operational block, an item clipped at the
 * beginning of the initial 14-day visible range (2026-08-19 → 2026-09-02),
 * an item clipped at the end of it, and a one-night reservation.
 */
export const MOCK_TIMELINE_ITEMS: TimelineItem[] = [
  // The BHA House — Room 101 (Deluxe): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-101-a",
    propertyId: "bha-house",
    roomId: "room-101",
    guestName: "Nguyen Minh Anh",
    sourceId: "direct",
    startDate: "2026-08-15",
    endDate: "2026-08-21",
  },
  {
    kind: "assigned-reservation",
    id: "res-house-101-b",
    propertyId: "bha-house",
    roomId: "room-101",
    guestName: "Tran Bao Long",
    sourceId: "booking_com",
    startDate: "2026-08-21",
    endDate: "2026-08-24",
  },

  // The BHA House — Room 102 (Deluxe): one-night stay, then a long stay.
  {
    kind: "assigned-reservation",
    id: "res-house-102-a",
    propertyId: "bha-house",
    roomId: "room-102",
    guestName: "Le Thi Hoa",
    sourceId: "agoda",
    startDate: "2026-08-20",
    endDate: "2026-08-21",
  },
  {
    kind: "assigned-reservation",
    id: "res-house-102-b",
    propertyId: "bha-house",
    roomId: "room-102",
    guestName: "Pham Quoc Bao",
    sourceId: "direct",
    startDate: "2026-08-24",
    endDate: "2026-08-31",
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
    guestName: "Carlos Mendes",
    sourceId: "booking_com",
    startDate: "2026-08-22",
    endDate: "2026-08-26",
  },

  // The BHA House — Room 202 (Suite): clipped at the end of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-house-202-a",
    propertyId: "bha-house",
    roomId: "room-202",
    guestName: "Yuki Tanaka",
    sourceId: "agoda",
    startDate: "2026-08-30",
    endDate: "2026-09-05",
  },

  // The BHA House — Suite room type: unassigned reservation.
  {
    kind: "unassigned-reservation",
    id: "unassigned-house-suite-a",
    propertyId: "bha-house",
    roomTypeId: "rt-house-suite",
    guestName: "Walk-in Family Group",
    sourceId: "direct",
    startDate: "2026-08-21",
    endDate: "2026-08-23",
  },

  // The BHA Riverside — Room 301 (Standard): clipped at the start of the initial range.
  {
    kind: "assigned-reservation",
    id: "res-riverside-301-a",
    propertyId: "bha-riverside",
    roomId: "room-301",
    guestName: "Mohammed Al-Farsi",
    sourceId: "booking_com",
    startDate: "2026-08-18",
    endDate: "2026-08-23",
  },

  // The BHA Riverside — Room 302 (Standard): short reservation.
  {
    kind: "assigned-reservation",
    id: "res-riverside-302-a",
    propertyId: "bha-riverside",
    roomId: "room-302",
    guestName: "Sara Kim",
    sourceId: "agoda",
    startDate: "2026-08-25",
    endDate: "2026-08-27",
  },

  // The BHA Riverside — Room 401 (Family): long reservation.
  {
    kind: "assigned-reservation",
    id: "res-riverside-401-a",
    propertyId: "bha-riverside",
    roomId: "room-401",
    guestName: "The Rodriguez Family",
    sourceId: "direct",
    startDate: "2026-08-20",
    endDate: "2026-08-28",
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
    roomTypeId: "rt-riverside-family",
    guestName: "Unassigned OTA Group",
    sourceId: "booking_com",
    startDate: "2026-08-28",
    endDate: "2026-09-04",
  },
];
