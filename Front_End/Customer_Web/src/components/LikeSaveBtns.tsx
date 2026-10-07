"use client";

import React, { FC, useEffect, useState } from "react";

export interface LikeSaveBtnsProps {
  /** Public address to share (identity and search only — never a token or contact). */
  shareUrl?: string;
  shareTitle?: string;
  /** Key under which "Save" is remembered on this device. Without it Save only toggles for the page's lifetime. */
  saveKey?: string;
}

const STORAGE_PREFIX = "bha.saved.";

function readSaved(key: string | undefined): boolean {
  if (!key) return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function writeSaved(key: string | undefined, saved: boolean) {
  if (!key) return;
  try {
    if (saved) window.localStorage.setItem(STORAGE_PREFIX + key, "1");
    else window.localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // private mode / blocked storage: the toggle still works for this page view
  }
}

const BUTTON =
  "py-1.5 px-3 flex rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000";

/**
 * The template's Share / Save pair. Share uses the browser's share sheet when there is one and copies
 * the address otherwise, and says what happened. Save is a heart toggle remembered on this device only
 * — no account, no wishlist backend — and says so.
 */
const LikeSaveBtns: FC<LikeSaveBtnsProps> = ({ shareUrl, shareTitle, saveKey }) => {
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setSaved(readSaved(saveKey));
  }, [saveKey]);

  const share = async () => {
    const url = shareUrl ?? window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url, title: shareTitle });
        setFeedback("Đã mở chia sẻ");
        return;
      }
      await navigator.clipboard.writeText(url);
      setFeedback("Đã sao chép liên kết");
    } catch {
      // a dismissed share sheet is not an error worth reporting; a failed copy is
      if (typeof navigator.share !== "function") setFeedback("Không sao chép được liên kết");
    }
  };

  const toggleSave = () => {
    const next = !saved;
    setSaved(next);
    writeSaved(saveKey, next);
    setFeedback(next ? "Đã lưu trên thiết bị này" : "Đã bỏ lưu");
  };

  return (
    <div className="flow-root">
      <div className="flex text-neutral-700 dark:text-neutral-300 text-sm -mx-3 -my-1.5">
        <button type="button" onClick={share} className={BUTTON}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          <span className="hidden sm:block ml-2.5">Share</span>
        </button>
        <button type="button" onClick={toggleSave} aria-pressed={saved} className={BUTTON}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill={saved ? "currentColor" : "none"}
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          <span className="hidden sm:block ml-2.5">{saved ? "Saved" : "Save"}</span>
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {feedback}
      </span>
      {feedback && (
        <span aria-hidden="true" className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
          {feedback}
        </span>
      )}
    </div>
  );
};

export default LikeSaveBtns;
