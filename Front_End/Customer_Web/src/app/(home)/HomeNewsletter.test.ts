import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { isValidElement, type ReactElement } from "react";
import HomeNewsletter from "./HomeNewsletter";
import { submitNewsletterEmail, type NewsletterSubmitResult } from "@/lib/newsletterApi";
import { NEWSLETTER_FAILED_MESSAGE, NEWSLETTER_RECEIVED_MESSAGE, NEWSLETTER_STORAGE_NOTICE, NEWSLETTER_SUBSCRIBE_LABEL } from "@/lib/newsletterUi";

/**
 * BHA-NEWSLETTER-001-C1: while a request is on its way the e-mail field cannot be edited, so the answer to the
 * address that was sent can never clear a newer one. Customer_Web has no DOM test library, so the component function is
 * driven by hand: a minimal `useState`/`useRef` stand-in keeps the slots between renders and the element tree is read.
 */
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useState = (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (next: unknown) => void (hooks.slots[i] = next)];
  };
  const useRef = (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  };
  const useEffect = () => undefined;
  return { ...actual, default: { ...actual, useState, useRef, useEffect }, useState, useRef, useEffect };
});
vi.mock("@/lib/i18n/I18nProvider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/newsletterApi", () => ({ submitNewsletterEmail: vi.fn() }));

type Props = Record<string, unknown>;
const find = (node: unknown, predicate: (props: Props, type: unknown) => boolean): ReactElement | undefined => {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  const props = node.props as Props;
  return predicate(props, node.type) ? node : find(props.children, predicate);
};

const field = { value: "ten@example.com", focus: () => undefined };
let tree: ReactElement;
const render = () => {
  hooks.cursor = 0;
  tree = HomeNewsletter({}) as ReactElement;
  const input = find(tree, (_, type) => type === "input") as ReactElement & { ref: { current: unknown } };
  input.ref.current = field;
  return {
    input: input.props as Props,
    button: find(tree, (_, type) => type === "button")!.props as Props,
    form: find(tree, (_, type) => type === "form")!.props as Props,
    feedback: find(tree, (props) => props.id === "newsletter-feedback")?.props as Props | undefined,
  };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Submits the form and returns a way to answer the request that is now pending. */
const submitPending = async () => {
  let answer!: (result: NewsletterSubmitResult) => void;
  vi.mocked(submitNewsletterEmail).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  void (render().form.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: () => undefined });
  await settle();
  return answer;
};

beforeEach(() => {
  hooks.slots.length = 0;
  field.value = "ten@example.com";
  vi.mocked(submitNewsletterEmail).mockReset();
});

describe("HomeNewsletter while a request is pending", () => {
  it("makes the e-mail field read-only and the button disabled, and only then answers 202 by emptying the field and reopening it", async () => {
    const answer = await submitPending();
    expect(submitNewsletterEmail).toHaveBeenCalledTimes(1);
    let view = render();
    expect(view.input.readOnly).toBe(true);
    expect(view.button.disabled).toBe(true);

    answer({ kind: "received" });
    await settle();
    view = render();
    expect(field.value).toBe("");
    expect(view.input.readOnly).toBe(false);
    expect(view.button.disabled).toBe(false);
    expect(view.feedback).toMatchObject({ role: "status", children: NEWSLETTER_RECEIVED_MESSAGE });
  });

  it("reopens the field on a failure, keeps the address, and lets the visitor send it again", async () => {
    const answer = await submitPending();
    expect(render().input.readOnly).toBe(true);

    answer({ kind: "failed", message: NEWSLETTER_FAILED_MESSAGE });
    await settle();
    let view = render();
    expect(field.value).toBe("ten@example.com");
    expect(view.input.readOnly).toBe(false);
    expect(view.button.disabled).toBe(false);
    expect(view.feedback).toMatchObject({ role: "alert", children: NEWSLETTER_FAILED_MESSAGE });

    const retry = await submitPending();
    expect(submitNewsletterEmail).toHaveBeenCalledTimes(2);
    expect(render().input.readOnly).toBe(true);
    retry({ kind: "received" });
    await settle();
    view = render();
    expect(field.value).toBe("");
    expect(view.input.readOnly).toBe(false);
  });
});

describe("HomeNewsletter texts (BHA-NEWSLETTER-001-C3)", () => {
  it("reads the storage notice and the button's accessible name from their own keys, never from the preview's keys", () => {
    // `useT` is the identity here, so what the form renders is the key it asked for.
    const view = render();
    expect(view.button["aria-label"]).toBe(NEWSLETTER_SUBSCRIBE_LABEL);
    expect(find(tree, (props) => props.id === "newsletter-disclosure")?.props).toMatchObject({ children: NEWSLETTER_STORAGE_NOTICE });
    const asked = JSON.stringify([view.button["aria-label"], (find(tree, (props) => props.id === "newsletter-disclosure")?.props as Props).children]);
    expect(asked).not.toContain("customer.newsletter.disclosure");
    expect(asked).not.toContain("subscribeDemoYourEmailIs");
  });
});
