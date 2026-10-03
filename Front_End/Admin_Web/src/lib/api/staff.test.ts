/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 2–4 and 15: the three Staff session
 * calls — what goes on the wire, and what each answer means.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStaffSession, parseStaffSession, staffLogin, staffLogout } from "./staff";

const BASE_URL = "https://localhost:7145";
const SESSION = {
  staffAccountId: "11111111-1111-1111-1111-111111111111",
  email: "desk@example.com",
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
};

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("staffLogin", () => {
  it("posts the email and the password exactly as typed — no trim, no 128 limit — with the Staff cookie and JSON, and no hand-made Origin", async () => {
    const fetchSpy = respond(200, SESSION);
    vi.stubGlobal("fetch", fetchSpy);
    const password = `  ${"Ab1!".repeat(75)}  `; // 304 characters, padded with spaces

    expect(await staffLogin("desk@example.com", password)).toEqual({ kind: "signed-in" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/admin/v1/auth/login`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ email: "desk@example.com", password });
    expect(JSON.parse(init.body).password).toHaveLength(304);
  });

  it.each([
    [401, "invalid-credentials"],
    [429, "rate-limited"],
    [400, "invalid-request"],
  ])("maps %i to %s", async (status, kind) => {
    vi.stubGlobal("fetch", respond(status, { title: "x" }));
    expect((await staffLogin("desk@example.com", "pw")).kind).toBe(kind);
  });

  it("reports a 403 (Origin) or 5xx as refused, and a network failure as network — once, never retried", async () => {
    vi.stubGlobal("fetch", respond(403, { title: "Origin not allowed" }));
    expect(await staffLogin("desk@example.com", "pw")).toEqual({ kind: "refused", status: 403 });
    const failing = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", failing);
    expect(await staffLogin("desk@example.com", "pw")).toEqual({ kind: "network" });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the access mode is invalid", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "staff");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await staffLogin("desk@example.com", "pw")).kind).toBe("config");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchStaffSession", () => {
  it("reads me with the Staff cookie and returns exactly the backend shape", async () => {
    const fetchSpy = respond(200, { ...SESSION, extra: "ignored" });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchStaffSession()).toEqual({ kind: "authenticated", session: SESSION });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/admin/v1/me`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
  });

  it("treats only 401 as signed out", async () => {
    vi.stubGlobal("fetch", respond(401, { title: "Authentication required" }));
    expect(await fetchStaffSession()).toEqual({ kind: "unauthenticated" });
  });

  it("never reads a network failure, a 5xx or a 403 as signed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await fetchStaffSession()).kind).toBe("error");
    vi.stubGlobal("fetch", respond(503));
    expect((await fetchStaffSession()).kind).toBe("error");
    vi.stubGlobal("fetch", respond(403));
    expect((await fetchStaffSession()).kind).toBe("error");
  });

  it.each([
    ["not JSON", "<html>"],
    ["no id", { ...SESSION, staffAccountId: "" }],
    ["memberships not a list", { ...SESSION, memberships: {} }],
    ["a membership without a role", { ...SESSION, memberships: [{ propertyId: "p", propertyName: "P", timeZone: "UTC" }] }],
    ["a wrapped body", { session: SESSION }],
  ])("closes access on a 200 it cannot read (%s)", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 }))
    );
    expect((await fetchStaffSession()).kind).toBe("error");
  });

  it("keeps an unknown role as data — the UI grants it nothing", () => {
    expect(parseStaffSession({ ...SESSION, memberships: [{ ...SESSION.memberships[0], role: "Viewer" }] })?.memberships[0].role).toBe(
      "Viewer"
    );
  });
});

describe("staffLogout", () => {
  it("posts {} as JSON with the Staff cookie; 204 is a confirmed logout", async () => {
    const fetchSpy = respond(204);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await staffLogout()).toEqual({ kind: "logged-out" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/admin/v1/auth/logout`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe("{}");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("401 means the session had already ended", async () => {
    vi.stubGlobal("fetch", respond(401, { title: "Authentication required" }));
    expect(await staffLogout()).toEqual({ kind: "session-ended" });
  });

  it("a 403, a 5xx or a network failure is never reported as a logout", async () => {
    for (const fetchSpy of [respond(403, { title: "Origin not allowed" }), respond(500), vi.fn().mockRejectedValue(new TypeError("x"))]) {
      vi.stubGlobal("fetch", fetchSpy);
      expect((await staffLogout()).kind).toBe("unconfirmed");
    }
  });
});
