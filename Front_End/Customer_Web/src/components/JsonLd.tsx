import React from "react";

/**
 * Structured data as `<script type="application/ld+json">`. The value is serialised with `JSON.stringify` and every character that could close the
 * script element or break a JS parser (`<`, `>`, `&`, U+2028/2029) is escaped, so no text of a post can leave the JSON string it is in.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export default function JsonLd({ data, testId }: { data: unknown; testId?: string }) {
  return <script type="application/ld+json" data-testid={testId} dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
