"use client";

/**
 * BHA-BLOG-001-CP03: what the node views of the body editor need from the screen around them, without the editor knowing the screen: which Properties exist
 * (for a property intro), how to open the shared picture picker, and whether the body may be edited at all.
 */

import { createContext, useContext } from "react";

export interface PropertyOption {
  id: string;
  name: string;
}

/** A picture chosen in the picker. `description` is the library's default caption, offered when a picture is inserted — never written over an alt or a caption. */
export interface PickedMedia {
  id: string;
  description: string;
}

export interface BodyEditorServices {
  editable: boolean;
  properties: PropertyOption[];
  /** Opens the shared picture picker; resolves with the chosen pictures, or `null` when it is closed without a choice. */
  pickMedia: (options: { multiple: boolean; min?: number; max?: number; title: string }) => Promise<PickedMedia[] | null>;
}

export const BodyEditorServicesContext = createContext<BodyEditorServices | null>(null);

export function useBodyEditorServices(): BodyEditorServices {
  const services = useContext(BodyEditorServicesContext);
  if (!services) throw new Error("useBodyEditorServices must be used inside RichBodyEditor.");
  return services;
}
