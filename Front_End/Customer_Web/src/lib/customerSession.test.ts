import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import type { CustomerIdentity } from "@/lib/api/authService";
import {
  CustomerSessionState,
  LOADING_SESSION,
  createCustomerSessionController,
} from "@/lib/customerSession";

const ALICE: CustomerIdentity = { customerAccountId: "11111111-1111-4111-8111-111111111111", email: "alice@example.test" };
const BOB: CustomerIdentity = { customerAccountId: "22222222-2222-4222-8222-222222222222", email: "bob@example.test" };

function httpError(status: number) {
  return new ApiHttpError(status, { title: "x", status });
}

/** One pending `readSession` call the test settles by hand. */
interface PendingRead {
  signal: AbortSignal;
  resolve: (customer: CustomerIdentity) => void;
  reject: (reason: unknown) => void;
}

function harness() {
  const reads: PendingRead[] = [];
  const invalidateCsrf = vi.fn();
  const readSession = vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<CustomerIdentity>((resolve, reject) => {
        reads.push({ signal, resolve, reject });
      })
  );
  const controller = createCustomerSessionController({ readSession, invalidateCsrf });
  const seen: CustomerSessionState[] = [];
  controller.subscribe(() => seen.push(controller.getState()));
  return { controller, reads, readSession, invalidateCsrf, seen };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("customer session controller — states", () => {
  it("starts loading with no customer and reads nothing until started", () => {
    const { controller, readSession } = harness();
    expect(controller.getState()).toEqual({ status: "loading", customer: null });
    expect(readSession).not.toHaveBeenCalled();
  });

  it("start reads once, drops the CSRF cache without requesting a token, and publishes 200 as authenticated", async () => {
    const { controller, reads, readSession, invalidateCsrf } = harness();
    controller.start();
    expect(readSession).toHaveBeenCalledTimes(1);
    expect(invalidateCsrf).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("loading");

    reads[0].resolve(ALICE);
    await settle();
    expect(controller.getState()).toEqual({ status: "authenticated", customer: ALICE });
  });

  it("publishes a 401 as anonymous", async () => {
    const { controller, reads } = harness();
    controller.start();
    reads[0].reject(httpError(401));
    await settle();
    expect(controller.getState()).toEqual({ status: "anonymous", customer: null });
  });

  it.each([
    ["403", httpError(403)],
    ["500", httpError(500)],
    ["network failure", new ApiNetworkError()],
    ["configuration failure", new ApiConfigError("bad base")],
    ["malformed response", new Error("The server returned an unexpected authentication response.")],
  ])("publishes a %s as unknown — neither anonymous nor an identity", async (_name, error) => {
    const { controller, reads } = harness();
    controller.start();
    reads[0].reject(error);
    await settle();
    expect(controller.getState()).toEqual({ status: "unknown", customer: null });
  });

  it("does not turn a cancellation into unknown or anonymous", async () => {
    const { controller, reads } = harness();
    controller.start();
    reads[0].reject(new axios.CanceledError());
    await settle();
    expect(controller.getState()).toEqual({ status: "loading", customer: null });
  });

  it("refresh clears the identity first (loading, customer null), then publishes the new answer — including unknown after authenticated", async () => {
    const { controller, reads, invalidateCsrf } = harness();
    controller.start();
    reads[0].resolve(ALICE);
    await settle();
    expect(controller.getState().customer).toEqual(ALICE);

    controller.refresh();
    expect(controller.getState()).toEqual({ status: "loading", customer: null });
    expect(invalidateCsrf).toHaveBeenCalledTimes(2);

    reads[1].reject(new ApiNetworkError());
    await settle();
    expect(controller.getState()).toEqual({ status: "unknown", customer: null });
  });

  it("notifies subscribers of each change and stops notifying after unsubscribe", async () => {
    const { controller, reads } = harness();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.start();
    reads[0].resolve(ALICE);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1); // loading → authenticated (initial state already loading)
    unsubscribe();
    controller.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("customer session controller — only the latest read publishes", () => {
  it("me(A) in flight, refresh(B) → 401, then A → 200: the state stays anonymous, never A", async () => {
    const { controller, reads, seen } = harness();
    controller.start();
    controller.refresh();
    expect(reads).toHaveLength(2);

    reads[1].reject(httpError(401));
    await settle();
    expect(controller.getState()).toEqual({ status: "anonymous", customer: null });

    reads[0].resolve(ALICE);
    await settle();
    expect(controller.getState()).toEqual({ status: "anonymous", customer: null });
    expect(seen.some((state) => state.customer?.customerAccountId === ALICE.customerAccountId)).toBe(false);
  });

  it("a late failure of the older read does not override a newer success", async () => {
    const { controller, reads } = harness();
    controller.start();
    controller.refresh();
    reads[1].resolve(BOB);
    await settle();
    reads[0].reject(new ApiNetworkError());
    await settle();
    expect(controller.getState()).toEqual({ status: "authenticated", customer: BOB });
  });

  it("aborts the superseded read when a refresh starts", () => {
    const { controller, reads } = harness();
    controller.start();
    expect(reads[0].signal.aborted).toBe(false);
    controller.refresh();
    expect(reads[0].signal.aborted).toBe(true);
    expect(reads[1].signal.aborted).toBe(false);
  });

  it("an older read that settles after the newer one has published cannot clear the newer read's pending marker", async () => {
    const { controller, reads } = harness();
    controller.start();
    controller.refresh();
    reads[0].resolve(ALICE);
    await settle();
    // stop must still abort the newer, still-pending read
    controller.stop();
    expect(reads[1].signal.aborted).toBe(true);
  });
});

describe("customer session controller — lifecycle", () => {
  it("stop aborts the pending read; nothing is published afterwards and a late rejection is not unhandled", async () => {
    const { controller, reads, seen } = harness();
    controller.start();
    controller.stop();
    expect(reads[0].signal.aborted).toBe(true);
    const before = seen.length;

    reads[0].resolve(ALICE);
    await settle();
    expect(seen).toHaveLength(before);
    expect(controller.getState().customer).toBeNull();

    const second = harness();
    second.controller.start();
    second.controller.stop();
    second.reads[0].reject(httpError(401));
    await settle();
    expect(second.controller.getState().status).toBe("loading");
  });

  it("works through React StrictMode's start → stop → start: the first read is aborted and only the second can publish", async () => {
    const { controller, reads, readSession } = harness();
    controller.start();
    controller.stop();
    controller.start();
    expect(readSession).toHaveBeenCalledTimes(2);
    expect(reads[0].signal.aborted).toBe(true);

    reads[0].resolve(ALICE);
    await settle();
    expect(controller.getState().status).toBe("loading");

    reads[1].resolve(BOB);
    await settle();
    expect(controller.getState()).toEqual({ status: "authenticated", customer: BOB });
  });

  it("refresh is a no-op before start and after stop", () => {
    const { controller, readSession, invalidateCsrf } = harness();
    controller.refresh();
    controller.start();
    controller.stop();
    controller.refresh();
    expect(readSession).toHaveBeenCalledTimes(1);
    expect(invalidateCsrf).toHaveBeenCalledTimes(1);
  });

  it("start twice does not read twice", () => {
    const { controller, readSession } = harness();
    controller.start();
    controller.start();
    expect(readSession).toHaveBeenCalledTimes(1);
  });

  it("two controllers never share an identity or a read", async () => {
    const first = harness();
    const second = harness();
    first.controller.start();
    second.controller.start();
    first.reads[0].resolve(ALICE);
    second.reads[0].reject(httpError(401));
    await settle();
    expect(first.controller.getState()).toEqual({ status: "authenticated", customer: ALICE });
    expect(second.controller.getState()).toEqual({ status: "anonymous", customer: null });
    expect(LOADING_SESSION).toEqual({ status: "loading", customer: null });
  });
});

describe("customer session controller — read() and beginIdentityChange() (CP01b)", () => {
  it("read resolves with how the read ended, after publishing", async () => {
    const { controller, reads } = harness();
    controller.start();
    const second = controller.read();
    reads[1].resolve(ALICE);
    await expect(second).resolves.toBe("authenticated");
    expect(controller.getState()).toEqual({ status: "authenticated", customer: ALICE });

    const third = controller.read();
    reads[2].reject(httpError(401));
    await expect(third).resolves.toBe("anonymous");

    const fourth = controller.read();
    reads[3].reject(new ApiNetworkError());
    await expect(fourth).resolves.toBe("unknown");
    expect(controller.getState()).toEqual({ status: "unknown", customer: null });
  });

  it("a read that is overtaken resolves superseded and publishes nothing", async () => {
    const { controller, reads } = harness();
    controller.start();
    const older = controller.read(); // reads[1]; reads[0] is the first read made by start()
    controller.read(); // reads[2] overtakes it
    reads[1].resolve(ALICE);
    await expect(older).resolves.toBe("superseded");
    expect(controller.getState().customer).toBeNull();
  });

  it("read does nothing while stopped", async () => {
    const { controller, readSession } = harness();
    await expect(controller.read()).resolves.toBe("superseded");
    expect(readSession).not.toHaveBeenCalled();
  });

  it("beginIdentityChange clears the identity, aborts the read in flight and keeps its late answer out (no A while changing to B)", async () => {
    const { controller, reads } = harness();
    controller.start();
    reads[0].resolve(ALICE);
    await settle();
    controller.refresh(); // an ordinary read in flight, which would publish A again
    expect(controller.getState().status).toBe("loading");

    expect(controller.beginIdentityChange()).toBe(true);
    expect(reads[1].signal.aborted).toBe(true);
    expect(controller.getState()).toEqual({ status: "loading", customer: null });

    reads[1].resolve(ALICE); // the old answer arrives late
    await settle();
    expect(controller.getState()).toEqual({ status: "loading", customer: null });

    const recovery = controller.read(); // the canonical read after the change
    reads[2].resolve(BOB);
    await expect(recovery).resolves.toBe("authenticated");
    expect(controller.getState()).toEqual({ status: "authenticated", customer: BOB });
  });

  it("beginIdentityChange clears an already published identity without reading, and is refused while stopped", async () => {
    const { controller, reads, readSession } = harness();
    expect(controller.beginIdentityChange()).toBe(false);
    controller.start();
    reads[0].resolve(ALICE);
    await settle();
    expect(controller.getState().customer).toEqual(ALICE);

    expect(controller.beginIdentityChange()).toBe(true);
    expect(controller.getState()).toEqual({ status: "loading", customer: null });
    expect(readSession).toHaveBeenCalledTimes(1);

    controller.stop();
    expect(controller.beginIdentityChange()).toBe(false);
  });
});
