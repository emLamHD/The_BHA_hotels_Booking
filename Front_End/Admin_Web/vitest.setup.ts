import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// BHA-NEWSLETTER-LIVE-001: no test opens a real SignalR connection. This stand-in never connects (its `start()` stays pending) and makes no network call; the tests of the
// connection itself pass their own fake through `startNewsletterLive({ factory })`, and the screen's tests replace `@/lib/website/newsletterLive` to play the signals.
vi.mock("@microsoft/signalr", () => {
  class HubConnectionBuilder {
    withUrl() {
      return this;
    }
    configureLogging() {
      return this;
    }
    build() {
      return { on() {}, off() {}, onclose() {}, start: () => new Promise<void>(() => {}), stop: () => Promise.resolve() };
    }
  }
  return { HubConnectionBuilder, HttpTransportType: { WebSockets: 1 }, LogLevel: { None: 6 } };
});
