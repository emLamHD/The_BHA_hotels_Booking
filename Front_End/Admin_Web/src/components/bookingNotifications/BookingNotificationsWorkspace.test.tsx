import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, ok } from "@/components/website/websiteTestUtils";
import type { StaffSession } from "@/lib/api/staff";
import type { RecipientRoster, RecipientStaff } from "@/lib/api/bookingNotifications";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/bookingNotifications", async (original) => ({
  ...(await original<typeof import("@/lib/api/bookingNotifications")>()),
  readRecipientRoster: vi.fn(), saveStaffEmail: vi.fn(), setStaffEnabled: vi.fn(), saveFallbackEmail: vi.fn(),
}));
import BookingNotificationsScreen from "./BookingNotificationsScreen";
import { fetchStaffSession } from "@/lib/api/staff";
import { readRecipientRoster, saveFallbackEmail, saveStaffEmail, setStaffEnabled } from "@/lib/api/bookingNotifications";

const membership = (propertyId: string, propertyName: string, role: "FrontDesk" | "Manager") => ({ propertyId, propertyName, timeZone: "Asia/Ho_Chi_Minh", role });
const MANAGER: StaffSession = {
  staffAccountId: "11111111-1111-1111-1111-111111111111", email: "manager@example.com", permissions: [],
  memberships: [membership("p1", "The BHA Riverside", "Manager"), membership("p2", "The BHA Garden", "Manager"), membership("p3", "Desk Only", "FrontDesk")],
};
const FRONT_DESK: StaffSession = { ...MANAGER, memberships: [membership("p1", "The BHA Riverside", "FrontDesk")] };

const staff = (patch: Partial<RecipientStaff> = {}): RecipientStaff => ({
  staffAccountId: "s1", accountLabel: "d***@login.example · #s1000000", role: "FrontDesk", notificationEmail: null, isEnabled: true, chainConfigured: false, coverage: "NotConfigured", version: 0, ...patch,
});
const roster = (propertyId: string, rows: RecipientStaff[], fallback = { email: null as string | null, version: 0 }): RecipientRoster => ({ propertyId, staff: rows, fallback });

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: MANAGER });
  vi.mocked(readRecipientRoster).mockImplementation(async (propertyId) => ok(roster(propertyId, [staff()])));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const row = async () => within(await screen.findByTestId("booking-notification-row"));
const press = async (scope: ReturnType<typeof within>, testId: string) => userEvent.click(scope.getByTestId(testId).querySelector("button")!);

describe("BookingNotificationsScreen access", () => {
  it("sends nothing for an account that is not a Manager of any property", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: FRONT_DESK });

    render(<BookingNotificationsScreen />);

    expect(await screen.findByTestId("website-no-permission")).toHaveTextContent("không phải Manager");
    expect(readRecipientRoster).not.toHaveBeenCalled();
  });

  it("sends nothing without a signed-in session and goes to sign-in for this page", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "unauthenticated" });

    render(<BookingNotificationsScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/signin?returnTo=%2Fbooking-notifications"));
    expect(readRecipientRoster).not.toHaveBeenCalled();
  });

  it("offers only the properties the account manages", async () => {
    render(<BookingNotificationsScreen />);

    const select = await screen.findByTestId("booking-notification-property");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["The BHA Riverside", "The BHA Garden"]);
    await waitFor(() => expect(readRecipientRoster).toHaveBeenCalledWith("p1", expect.anything()));
    expect(readRecipientRoster).not.toHaveBeenCalledWith("p3", expect.anything());
  });
});

describe("BookingNotificationsScreen roster", () => {
  it("says Chưa cấu hình for an unconfigured person and never shows the login address and keeps the account label apart from the notification address", async () => {
    render(<BookingNotificationsScreen />);

    const r = await row();

    expect(r.getByTestId("booking-notification-coverage")).toHaveTextContent("Chưa cấu hình");
    expect(r.getByTestId("booking-notification-account")).toHaveTextContent("d***@login.example · #s1000000");
    expect(r.getByLabelText("Email nhận thông báo")).toHaveValue("");           // never prefilled from the login address
    expect(r.getByLabelText("Email nhận thông báo")).toHaveAttribute("placeholder", "Chưa cấu hình");
    expect(r.getByText(/email đăng nhập không được dùng/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("desk@login.example");
  });

  it("saves one address with the version it was read at, then reads the server again", async () => {
    vi.mocked(saveStaffEmail).mockResolvedValue(ok(staff({ notificationEmail: "front@hotel.example", coverage: "Local", version: 1 })));
    render(<BookingNotificationsScreen />);
    const r = await row();

    await userEvent.type(r.getByLabelText("Email nhận thông báo"), "  front@hotel.example ");
    vi.mocked(readRecipientRoster).mockImplementation(async (propertyId) => ok(roster(propertyId, [staff({ notificationEmail: "front@hotel.example", coverage: "Local", version: 1 })])));
    await press(r, "booking-notification-save");

    await waitFor(() => expect(saveStaffEmail).toHaveBeenCalledTimes(1));
    expect(saveStaffEmail).toHaveBeenCalledWith("p1", "s1", 0, "front@hotel.example");
    await waitFor(() => expect(within(screen.getByTestId("booking-notification-row")).getByTestId("booking-notification-coverage")).toHaveTextContent("Nhận qua email riêng"));
    expect(within(screen.getByTestId("booking-notification-row")).getByLabelText("Email nhận thông báo")).toHaveValue("front@hotel.example");   // survives the reload: that is the server's value
  });

  it.each(["a@b.example, c@d.example", "a@b.example c@d.example", "not-an-address", "a@b.example;c@d.example"])("refuses %j before sending anything", async (text) => {
    render(<BookingNotificationsScreen />);
    const r = await row();

    await userEvent.type(r.getByLabelText("Email nhận thông báo"), text);
    await press(r, "booking-notification-save");

    expect(await r.findByTestId("booking-notification-email-error")).toHaveTextContent("đúng một địa chỉ email");
    expect(saveStaffEmail).not.toHaveBeenCalled();
  });

  it("clears an address and switches a person off, each as one write", async () => {
    vi.mocked(readRecipientRoster).mockImplementation(async (propertyId) => ok(roster(propertyId, [staff({ notificationEmail: "front@hotel.example", coverage: "Local", version: 2 })])));
    vi.mocked(saveStaffEmail).mockResolvedValue(ok(staff({ version: 3 })));
    vi.mocked(setStaffEnabled).mockResolvedValue(ok(staff({ isEnabled: false, coverage: "OptedOut", version: 3 })));
    render(<BookingNotificationsScreen />);
    const r = await row();

    await press(r, "booking-notification-clear");
    await waitFor(() => expect(saveStaffEmail).toHaveBeenCalledWith("p1", "s1", 2, null));
    await userEvent.click((await row()).getByTestId("booking-notification-enabled"));

    await waitFor(() => expect(setStaffEnabled).toHaveBeenCalledWith("p1", "s1", 2, false));
    expect(saveStaffEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and says nothing was saved when the version is stale", async () => {
    vi.mocked(saveStaffEmail).mockResolvedValue({ kind: "refused", status: 409, code: "stale-version", field: null, detail: "stale" });
    render(<BookingNotificationsScreen />);
    const r = await row();

    await userEvent.type(r.getByLabelText("Email nhận thông báo"), "mine@hotel.example");
    await press(r, "booking-notification-save");

    expect(await r.findByTestId("write-refused")).toHaveTextContent("Chưa có gì được lưu");
    expect(r.getByLabelText("Email nhận thông báo")).toHaveValue("mine@hotel.example");
    expect(r.getByTestId("reload-latest")).toBeInTheDocument();
  });

  it("shows the server's refusal of an address beside the field", async () => {
    vi.mocked(saveStaffEmail).mockResolvedValue({ kind: "refused", status: 400, code: "validation", field: "email", detail: "bad" });
    render(<BookingNotificationsScreen />);
    const r = await row();

    await userEvent.type(r.getByLabelText("Email nhận thông báo"), "ok@hotel.example");
    await press(r, "booking-notification-save");

    expect(await r.findByTestId("booking-notification-email-error")).toHaveTextContent("Máy chủ không nhận địa chỉ này");
  });

  it("warns when nobody would receive and edits the fallback with its own version", async () => {
    vi.mocked(readRecipientRoster).mockImplementation(async (propertyId) => ok(roster(propertyId, [staff()], { email: "desk@hotel.example", version: 4 })));
    vi.mocked(saveFallbackEmail).mockResolvedValue(ok({ email: "new@hotel.example", version: 5 }));
    render(<BookingNotificationsScreen />);

    expect(await screen.findByTestId("booking-notification-uncovered")).toHaveTextContent("email dự phòng");
    const card = within(await screen.findByTestId("booking-notification-fallback"));
    const input = card.getByLabelText("Email dự phòng");
    await userEvent.clear(input);
    await userEvent.type(input, "new@hotel.example");
    await press(card, "booking-notification-fallback-save");

    await waitFor(() => expect(saveFallbackEmail).toHaveBeenCalledWith("p1", 4, "new@hotel.example"));
  });
});

describe("BookingNotificationsScreen Property switch", () => {
  it("aborts the previous Property's read and never shows its addresses under the new one", async () => {
    const late = deferred<ReturnType<typeof ok<RecipientRoster>>>();
    let firstSignal: AbortSignal | undefined;
    vi.mocked(readRecipientRoster).mockImplementation((propertyId, signal) => {
      if (propertyId === "p1") {
        firstSignal = signal;
        return late.promise;                       // the old Property answers only after the Manager has moved on
      }
      return Promise.resolve(ok(roster("p2", [staff({ staffAccountId: "g1", accountLabel: "g***@login.example · #g1000000", notificationEmail: "garden@hotel.example", coverage: "Local", version: 1 })])));
    });
    render(<BookingNotificationsScreen />);
    await waitFor(() => expect(readRecipientRoster).toHaveBeenCalledWith("p1", expect.anything()));

    await userEvent.selectOptions(await screen.findByTestId("booking-notification-property"), "p2");
    await screen.findByDisplayValue("garden@hotel.example");
    expect(firstSignal?.aborted).toBe(true);

    late.resolve(ok(roster("p1", [staff({ staffAccountId: "r1", accountLabel: "r***@login.example · #r1000000", notificationEmail: "riverside-secret@hotel.example", coverage: "Local", version: 3 })])));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByDisplayValue("riverside-secret@hotel.example")).toBeNull();
    expect(screen.queryByText("r***@login.example · #r1000000")).toBeNull();
    expect(screen.getByTestId("booking-notification-roster")).toHaveAttribute("data-property", "p2");
  });

  it("refuses an answer that names another Property even when it arrives for the current one", async () => {
    vi.mocked(readRecipientRoster).mockImplementation(async () => ok(roster("p2", [staff({ notificationEmail: "other@hotel.example", coverage: "Local", version: 1 })])));
    render(<BookingNotificationsScreen />);

    expect(await screen.findByTestId("website-load-error")).toHaveTextContent("cơ sở khác");
    expect(screen.queryByDisplayValue("other@hotel.example")).toBeNull();
  });

  it("a Property switch does not carry a draft or a refusal over to the other Property", async () => {
    vi.mocked(saveStaffEmail).mockResolvedValue({ kind: "refused", status: 409, code: "stale-version", field: null, detail: "stale" });
    render(<BookingNotificationsScreen />);
    const r = await row();
    await userEvent.type(r.getByLabelText("Email nhận thông báo"), "draft@hotel.example");
    await press(r, "booking-notification-save");
    await r.findByTestId("write-refused");

    await userEvent.selectOptions(await screen.findByTestId("booking-notification-property"), "p2");

    await waitFor(() => expect(screen.getByTestId("booking-notification-roster")).toHaveAttribute("data-property", "p2"));
    expect(screen.queryByDisplayValue("draft@hotel.example")).toBeNull();
    expect(screen.queryByTestId("write-refused")).toBeNull();
  });
});
