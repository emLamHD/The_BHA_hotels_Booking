import { searchAvailability } from "@/lib/api/availabilityService";
import type { AvailabilityOfferDto, AvailabilityQuery } from "@/lib/api/availabilityTypes";
import { AvailabilityDraft, validateAvailabilityDraft } from "@/lib/api/availabilityValidation";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { ApiRequestOptions, isRequestCancelledError } from "@/lib/api/httpClient";
import { getProperties } from "@/lib/api/propertyService";
import type { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { findPropertyBySlug } from "@/lib/featuredBrands";
import { buildRoomDetailsHref, sameId } from "@/lib/roomDetailsRoute";
import { quoteForRoomType, RoomQuote } from "@/lib/roomQuote";
import { ListingQueryProblem, StayListingQuery, brandInfo, stayListingKey } from "@/lib/stayListingQuery";

/**
 * CUST-WEB-001-CP05a: the request lifecycle behind /listing-stay. React-free, so the tests drive it with
 * deferred promises. It is the page's own controller: it does not use the home StaySearchProvider and
 * publishes nothing to it. Every request is a safe GET (catalog, room types, availability); no hold, no
 * confirmation, no token, no CSRF.
 *
 * Identity rule: every state carries the key of the URL it was made for, and an answer is published only
 * if its generation is still the current one. An aborted request is not trusted to have stopped — the
 * generation check is what keeps a late answer for query A from becoming the page of query B.
 */

export type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** The API's property list has no property with the brand's slug. */
  | { status: "missing" }
  /** The property exists but lists no room types. */
  | { status: "empty"; property: PropertyDto }
  | { status: "ready"; property: PropertyDto; roomTypes: RoomTypeDto[] };

export type AvailabilityState =
  /** Browse mode: no availability was asked and none is shown. */
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string; retryable: boolean }
  | { status: "success"; offers: AvailabilityOfferDto[] };

export type ListingState =
  /** Before the first query is applied (and after dispose). Shows nothing but a loading placeholder. */
  | { kind: "idle" }
  | { kind: "invalid"; key: string; problems: ListingQueryProblem[] }
  /** House / Villa: no catalog exists, so no request is made and no other brand's rooms are shown. */
  | { kind: "unsupported-brand"; key: string; brand: "house" | "villa" }
  | {
      kind: "riverside";
      key: string;
      /** The validated search the availability belongs to; null in browse mode. */
      search: AvailabilityDraft | null;
      catalog: CatalogState;
      availability: AvailabilityState;
    };

export interface ListingDeps {
  getProperties(options: ApiRequestOptions): Promise<PropertyDto[]>;
  getRoomTypes(propertyId: string, options: ApiRequestOptions): Promise<RoomTypeDto[]>;
  searchAvailability(
    propertyId: string,
    query: AvailabilityQuery,
    options: ApiRequestOptions
  ): Promise<AvailabilityOfferDto[]>;
}

export const defaultListingDeps: ListingDeps = { getProperties, getRoomTypes, searchAvailability };

export interface DescribedError {
  message: string;
  /** Whether asking again can help (network, server trouble) — a rejected search will be rejected again. */
  retryable: boolean;
}

/** Fixed, safe copy: nothing the server said, no status text, no URL. */
export function describeListingError(error: unknown, scope: "catalog" | "availability"): DescribedError {
  if (error instanceof ApiConfigError) {
    return { message: "Dịch vụ đặt phòng chưa được cấu hình đúng.", retryable: false };
  }
  if (error instanceof ApiNetworkError) {
    return { message: "Không kết nối được tới hệ thống đặt phòng. Kiểm tra kết nối rồi thử lại.", retryable: true };
  }
  if (scope === "availability" && error instanceof ApiHttpError && (error.status === 400 || error.status === 422)) {
    return {
      message: "Hệ thống không nhận tìm kiếm này. Hãy kiểm tra ngày và số khách rồi tìm lại.",
      retryable: false,
    };
  }
  return { message: "Hệ thống đặt phòng đang gặp sự cố. Hãy thử lại sau.", retryable: true };
}

export interface ListingController {
  getState(): ListingState;
  subscribe(listener: () => void): () => void;
  /** Applies the URL's query. The same key again is a no-op; a different one cancels what the old one needed. */
  setQuery(query: StayListingQuery): void;
  /** Reads the current query again: one logical request, never a cached price. */
  retry(): void;
  /** Aborts everything and forgets the page: nothing that arrives afterwards is published. */
  dispose(): void;
}

export function createListingController(deps: ListingDeps = defaultListingDeps): ListingController {
  let state: ListingState = { kind: "idle" };
  const listeners = new Set<() => void>();

  let currentKey: string | null = null;
  let generation = 0;
  let availabilityAbort: AbortController | null = null;

  // The catalog is read once per page and reused while it is a good answer; it has its own generation
  // so that moving between two Riverside queries does not throw away a catalog still on its way.
  let catalogGeneration = 0;
  let catalogAbort: AbortController | null = null;
  let catalogLoading = false;
  let catalogResult: Exclude<CatalogState, { status: "loading" } | { status: "error" }> | null = null;

  const publish = (next: ListingState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const abortAvailability = () => {
    availabilityAbort?.abort();
    availabilityAbort = null;
  };
  const abortCatalog = () => {
    catalogGeneration += 1;
    catalogAbort?.abort();
    catalogAbort = null;
    catalogLoading = false;
  };

  const updateRiverside = (patch: Partial<Extract<ListingState, { kind: "riverside" }>>) => {
    if (state.kind !== "riverside") return;
    publish({ ...state, ...patch });
  };

  const startAvailability = (property: PropertyDto, search: AvailabilityDraft) => {
    abortAvailability();
    const validated = validateAvailabilityDraft(search);
    if (!validated.ok) return; // parsing validated it already; this only narrows the type
    const controller = new AbortController();
    availabilityAbort = controller;
    const gen = generation;
    updateRiverside({ availability: { status: "loading" } });
    deps
      .searchAvailability(property.id, validated.value, { signal: controller.signal })
      .then((offers) => {
        if (gen !== generation || controller.signal.aborted) return;
        updateRiverside({ availability: { status: "success", offers } });
      })
      .catch((error) => {
        if (gen !== generation || controller.signal.aborted || isRequestCancelledError(error)) return;
        const described = describeListingError(error, "availability");
        updateRiverside({ availability: { status: "error", message: described.message, retryable: described.retryable } });
      });
  };

  const startCatalog = (slug: string) => {
    abortCatalog();
    const controller = new AbortController();
    catalogAbort = controller;
    catalogLoading = true;
    const gen = catalogGeneration;
    const stale = () => gen !== catalogGeneration || controller.signal.aborted;

    const finish = (result: NonNullable<typeof catalogResult>) => {
      if (stale()) return;
      catalogLoading = false;
      catalogResult = result;
      if (state.kind !== "riverside") return;
      const search = state.search;
      updateRiverside({ catalog: result });
      if (result.status === "ready" && search) startAvailability(result.property, search);
    };
    const fail = (error: unknown) => {
      if (stale() || isRequestCancelledError(error)) return;
      catalogLoading = false;
      updateRiverside({
        catalog: { status: "error", message: describeListingError(error, "catalog").message },
        availability: { status: "none" },
      });
    };

    deps
      .getProperties({ signal: controller.signal })
      .then((properties) => {
        if (stale()) return;
        const property = findPropertyBySlug(properties, slug);
        if (!property) {
          finish({ status: "missing" });
          return;
        }
        return deps.getRoomTypes(property.id, { signal: controller.signal }).then((roomTypes) => {
          // A room type of another property is never this property's room.
          const own = roomTypes.filter((roomType) => sameId(roomType.propertyId, property.id));
          finish(own.length === 0 ? { status: "empty", property } : { status: "ready", property, roomTypes: own });
        });
      })
      .catch(fail);
  };

  const apply = (query: StayListingQuery, key: string) => {
    if (query.kind === "invalid") {
      abortCatalog();
      publish({ kind: "invalid", key, problems: query.problems });
      return;
    }
    const info = brandInfo(query.brand);
    if (!info.slug) {
      abortCatalog();
      publish({ kind: "unsupported-brand", key, brand: query.brand as "house" | "villa" });
      return;
    }
    const search = query.kind === "search" ? query.search : null;
    if (catalogResult) {
      publish({
        kind: "riverside",
        key,
        search,
        catalog: catalogResult,
        availability: search && catalogResult.status === "ready" ? { status: "loading" } : { status: "none" },
      });
      if (search && catalogResult.status === "ready") startAvailability(catalogResult.property, search);
      return;
    }
    publish({
      kind: "riverside",
      key,
      search,
      catalog: { status: "loading" },
      availability: search ? { status: "loading" } : { status: "none" },
    });
    if (!catalogLoading) startCatalog(info.slug);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(query) {
      const key = stayListingKey(query);
      if (key === currentKey) return;
      currentKey = key;
      generation += 1;
      abortAvailability();
      apply(query, key);
    },
    retry() {
      if (state.kind !== "riverside") return;
      const { search, catalog, availability } = state;
      if (catalog.status === "ready") {
        // Browse mode has no price to read again; a request already on its way is the one logical request.
        if (!search || availability.status === "loading") return;
        generation += 1;
        startAvailability(catalog.property, search);
        return;
      }
      if (catalog.status === "loading") return;
      const slug = brandInfo("riverside").slug as string;
      catalogResult = null;
      generation += 1;
      abortAvailability();
      updateRiverside({
        catalog: { status: "loading" },
        availability: search ? { status: "loading" } : { status: "none" },
      });
      startCatalog(slug);
    },
    dispose() {
      generation += 1;
      abortAvailability();
      abortCatalog();
      catalogResult = null;
      currentKey = null;
      state = { kind: "idle" };
    },
  };
}

export interface ListingCard {
  roomType: RoomTypeDto;
  /** Null in browse mode: there is no number to show. */
  quote: RoomQuote | null;
  href: string;
}

export interface ListingCards {
  cards: ListingCard[];
  /** Offers that were not used: another property, another room type, or another query than the one asked. */
  ignoredOffers: number;
}

function offerMatchesQuery(offer: AvailabilityOfferDto, property: PropertyDto, search: AvailabilityDraft): boolean {
  return (
    sameId(offer.propertyId, property.id) &&
    offer.checkIn === search.checkIn &&
    offer.checkOut === search.checkOut &&
    offer.requestedRooms === Number(search.rooms)
  );
}

/**
 * The cards of a Riverside page. Browse: every room type of the property, no price. Search: only the room
 * types that have an offer for this property and this query, priced by the real quote helper (cheapest
 * rate plan total, uniform nightly only when the server's nights are all equal). Each card links to the
 * room page by its own ids, carrying the five search fields when there is a valid search.
 */
export function buildListingCards(
  property: PropertyDto,
  roomTypes: readonly RoomTypeDto[],
  search: AvailabilityDraft | null,
  offers: readonly AvailabilityOfferDto[] | null
): ListingCards {
  const own = roomTypes.filter((roomType) => sameId(roomType.propertyId, property.id));
  if (!search || !offers) {
    return {
      cards: own.map((roomType) => ({
        roomType,
        quote: null,
        href: buildRoomDetailsHref({ propertyId: property.id, roomTypeId: roomType.id }),
      })),
      ignoredOffers: 0,
    };
  }
  const usable = offers.filter((offer) => offerMatchesQuery(offer, property, search));
  const cards: ListingCard[] = [];
  for (const roomType of own) {
    const quote = quoteForRoomType(usable, roomType.id);
    if (!quote) continue;
    cards.push({
      roomType,
      quote,
      href: buildRoomDetailsHref({ propertyId: property.id, roomTypeId: roomType.id }, search),
    });
  }
  const used = usable.filter((offer) => own.some((roomType) => sameId(roomType.id, offer.roomTypeId))).length;
  return { cards, ignoredOffers: offers.length - used };
}
