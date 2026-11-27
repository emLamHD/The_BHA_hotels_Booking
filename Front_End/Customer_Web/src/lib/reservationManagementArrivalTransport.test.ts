import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiNetworkError } from "@/lib/api/errors";

// BHA-CHECKOUT-001-PR09-C3: the controller on the REAL service and the REAL CSRF helper; only the HTTP client is replaced, so what reaches the transport is counted.
const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();
vi.mock("@/lib/api/httpClient", () => ({
  apiGet: (...a: unknown[]) => apiGetMock(...a),
  apiUnsafeRequest: (...a: unknown[]) => apiUnsafeRequestMock(...a),
  mergeHeaders: (h: Record<string, string>) => h,
  isRequestCancelledError: () => false,
}));

import { resetCsrfStateForTests } from "@/lib/api/csrf";
import { readManagedReservation, updateEstimatedArrival } from "@/lib/api/reservationManagementService";
import { MANAGE, createReservationManagementController } from "./reservationManagement";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const DTO = {
  reservationId: ID, confirmationNumber: "BHA-1", status: "Confirmed", propertyId: "p", roomTypeId: "r", ratePlanId: "p", fullName: "Jane Doe", checkIn: "2026-12-01", checkOut: "2026-12-03",
  adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const POST = `/api/v1/reservations/${ID}/manage/estimated-arrival`;
const calls = (mock: ReturnType<typeof vi.fn>, path: string) => mock.mock.calls.filter((c) => c[0] === path).length;
const MANAGE_PATH = `/api/v1/reservations/${ID}/manage`;

beforeEach(() => { apiGetMock.mockReset(); apiUnsafeRequestMock.mockReset(); resetCsrfStateForTests(); });

describe("the arrival update when the CSRF token cannot be read (PR09-C3 P2-2)", () => {
  it("sends 0 POSTs and no verifying GET; the next Save, once a token is read, sends exactly one POST", async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === MANAGE_PATH) return DTO;
      throw new ApiNetworkError(); // the CSRF token request fails
    });
    const controller = createReservationManagementController({
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {},
      read: (id, signal) => readManagedReservation(id, { signal }), update: updateEstimatedArrival,
    });
    controller.bind({ reservationId: ID, identityKey: "guest" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "error", messageKey: MANAGE.etaNotSent }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
    expect(calls(apiGetMock, MANAGE_PATH)).toBe(1); // the load only: no verifying GET

    apiGetMock.mockImplementation(async (path: string) => (path === MANAGE_PATH ? DTO : { token: "t", headerName: "X-CSRF-TOKEN" }));
    apiUnsafeRequestMock.mockResolvedValue({ status: 200, data: { ...DTO, estimatedArrival: { arrivalDate: "2026-12-02", arrivalTime: "09:00", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } } });
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
    expect(calls(apiGetMock, MANAGE_PATH)).toBe(1);
  });
});
