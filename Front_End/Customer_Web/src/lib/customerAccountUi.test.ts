import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/errors";
import type { CustomerIdentity } from "@/lib/api/authService";
import { describeAuthEntry } from "@/lib/customerAuthUi";
import { testT } from "@/lib/i18n/testkit";
import { AccountView, describeAccountView } from "@/lib/customerAccountUi";
import { IdentityChangePhase, createCustomerIdentityCoordinator } from "@/lib/customerIdentityChange";
import { CustomerSessionState, createCustomerSessionController } from "@/lib/customerSession";

const A: CustomerIdentity = { customerAccountId: "11111111-1111-4111-8111-111111111111", email: "Alice.A@Example.test" };
const B: CustomerIdentity = { customerAccountId: "22222222-2222-4222-8222-222222222222", email: "bob.b@example.test" };
const PHASES: IdentityChangePhase[] = ["idle", "transport", "recovering", "recovery-unresolved"];
const STATES: CustomerSessionState[] = [
  { status: "loading", customer: null },
  { status: "anonymous", customer: null },
  { status: "authenticated", customer: A },
  { status: "unknown", customer: null },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const http = (status: number) => new ApiHttpError(status, { title: "x", status, detail: "SECRET" });

describe("describeAccountView — the whole provider state × identity phase", () => {
  const expected: Record<string, Record<IdentityChangePhase, AccountView["kind"]>> = {
    loading: { idle: "checking", transport: "pending", recovering: "pending", "recovery-unresolved": "unresolved" },
    anonymous: { idle: "redirect-login", transport: "pending", recovering: "pending", "recovery-unresolved": "unresolved" },
    authenticated: { idle: "ready", transport: "pending", recovering: "pending", "recovery-unresolved": "unresolved" },
    unknown: { idle: "unresolved", transport: "pending", recovering: "pending", "recovery-unresolved": "unresolved" },
  };

  it.each(STATES.flatMap((state) => PHASES.map((phase) => [state.status, phase] as const)))(
    "%s + %s",
    (status, phase) => {
      const state = STATES.find((candidate) => candidate.status === status)!;
      expect(describeAccountView(state, phase).kind).toBe(expected[status][phase]);
    }
  );

  it("only authenticated + idle carries an email, and it is me's email byte for byte", () => {
    for (const state of STATES) {
      for (const phase of PHASES) {
        const view = describeAccountView(state, phase);
        if (state.status === "authenticated" && phase === "idle") {
          expect(view).toEqual({ kind: "ready", email: "Alice.A@Example.test" });
        } else {
          expect(JSON.stringify(view)).not.toContain("Alice");
          expect(view).not.toHaveProperty("email");
        }
      }
    }
  });

  it("redirects only for a verified anonymous while idle — never for loading, unknown or anything pending", () => {
    const redirecting = STATES.flatMap((state) => PHASES.map((phase) => ({ state, phase }))).filter(
      ({ state, phase }) => describeAccountView(state, phase).kind === "redirect-login"
    );
    expect(redirecting).toEqual([{ state: { status: "anonymous", customer: null }, phase: "idle" }]);
  });

  it("a stale authenticated snapshot is not shown while an identity change is pending or unresolved", () => {
    for (const phase of ["transport", "recovering", "recovery-unresolved"] as const) {
      expect(describeAccountView({ status: "authenticated", customer: A }, phase).kind).not.toBe("ready");
    }
  });
});

describe("account view with the real session controller and identity coordinator", () => {
  function rig() {
    const reads: ReturnType<typeof deferred<CustomerIdentity>>[] = [];
    const logouts: ReturnType<typeof deferred<unknown>>[] = [];
    const controller = createCustomerSessionController({
      readSession: () => {
        const d = deferred<CustomerIdentity>();
        reads.push(d);
        return d.promise;
      },
      invalidateCsrf: () => undefined,
    });
    const coordinator = createCustomerIdentityCoordinator({
      session: { beginIdentityChange: controller.beginIdentityChange, read: controller.read, refresh: controller.refresh },
      login: () => Promise.resolve(undefined),
      logout: () => {
        const d = deferred<unknown>();
        logouts.push(d);
        return d.promise;
      },
    });
    coordinator.activate();
    coordinator.bindBooking({ identityChangeBlockReason: () => null, scrubForIdentityChange: () => true });
    controller.start();
    const view = () => describeAccountView(controller.getState(), coordinator.getState().phase);
    return { controller, coordinator, reads, logouts, view };
  }

  it("the first read: checking, then ready with exactly me's email", async () => {
    const { reads, view } = rig();
    expect(view()).toEqual({ kind: "checking" });
    reads[0].resolve(A);
    await settle();
    expect(view()).toEqual({ kind: "ready", email: A.email });
  });

  it("an ordinary refresh drops A at once; a late answer of the superseded read cannot bring A back; only B is shown", async () => {
    const { controller, reads, view } = rig();
    reads[0].resolve(A);
    await settle();
    expect(view().kind).toBe("ready");

    controller.refresh(); // read #2 (pending)
    expect(view()).toEqual({ kind: "checking" });
    controller.refresh(); // read #3 supersedes #2
    reads[1].resolve(A); // the superseded read answers late
    await settle();
    expect(view()).toEqual({ kind: "checking" });
    reads[2].resolve(B);
    await settle();
    expect(view()).toEqual({ kind: "ready", email: B.email });
    expect(JSON.stringify(view())).not.toContain("Alice");
  });

  it("an ordinary failed read is unresolved (no redirect, no email), not anonymous", async () => {
    const { controller, reads, view } = rig();
    reads[0].resolve(A);
    await settle();
    controller.refresh();
    reads[1].reject(http(503));
    await settle();
    expect(view()).toEqual({ kind: "unresolved" });
    controller.refresh();
    reads[2].resolve(A);
    await settle();
    expect(view()).toEqual({ kind: "ready", email: A.email });
  });

  it("a guarded logout: pending (no email, no redirect) through the request and the read, then redirect on verified 401", async () => {
    const { coordinator, reads, logouts, view } = rig();
    reads[0].resolve(A);
    await settle();

    const result = coordinator.logout();
    expect(view()).toEqual({ kind: "pending" });
    logouts[0].resolve(undefined);
    await settle();
    expect(view()).toEqual({ kind: "pending" }); // transport done, `me` is being read: still undecided
    reads[1].reject(http(401));
    await result;
    expect(view()).toEqual({ kind: "redirect-login" });
  });

  it("a logout whose `me` read fails stays on the page as unresolved; a read-only re-check then decides", async () => {
    const { coordinator, reads, logouts, view } = rig();
    reads[0].resolve(A);
    await settle();

    const result = coordinator.logout();
    logouts[0].resolve(undefined);
    await settle();
    reads[1].reject(http(503));
    await result;
    expect(view()).toEqual({ kind: "unresolved" });

    coordinator.requestRefresh();
    expect(view().kind).not.toBe("ready");
    expect(view().kind).not.toBe("redirect-login");
    reads[2].reject(http(401));
    await settle();
    expect(view()).toEqual({ kind: "redirect-login" });
  });

  it("a logout refused by the guard changes nothing: still ready, same email", async () => {
    const reads: ReturnType<typeof deferred<CustomerIdentity>>[] = [];
    const controller = createCustomerSessionController({
      readSession: () => {
        const d = deferred<CustomerIdentity>();
        reads.push(d);
        return d.promise;
      },
      invalidateCsrf: () => undefined,
    });
    const coordinator = createCustomerIdentityCoordinator({
      session: { beginIdentityChange: controller.beginIdentityChange, read: controller.read, refresh: controller.refresh },
      login: () => Promise.resolve(undefined),
      logout: () => Promise.reject(new Error("never sent")),
    });
    coordinator.activate();
    coordinator.bindBooking({ identityChangeBlockReason: () => "booking-in-progress", scrubForIdentityChange: () => true });
    controller.start();
    reads[0].resolve(A);
    await settle();

    expect(await coordinator.logout()).toMatchObject({ status: "blocked" });
    expect(describeAccountView(controller.getState(), coordinator.getState().phase)).toEqual({ kind: "ready", email: A.email });
    expect(reads).toHaveLength(1); // no extra `me` read either
  });
});

describe("the entry and the page agree", () => {
  it("the entry offers /account exactly when the page would show the account", () => {
    for (const state of STATES) {
      for (const phase of PHASES) {
        const entry = describeAuthEntry(state.status, phase, state.customer?.email ?? null, testT("vi"));
        const view = describeAccountView(state, phase);
        if (entry.href === "/account") expect(view.kind).toBe("ready");
      }
    }
  });
});
