"use client";

import { useCallback, useRef, useState } from "react";

export type SuggestField = "tribe" | "season_goal";
export type SuggestedItem = { id: string; reason: string };
export type SuggestEntry = { status: "loading" | "ready"; items: SuggestedItem[] };

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function suggestionKey(field: SuggestField, story: string, tribe?: string) {
  return `${field}|${tribe ?? ""}|${hash(story.trim())}`;
}

/**
 * Asks the server for suggestions in the background, so by the time a person
 * reaches the question the answer is usually ready. A failure or a slow reply
 * just means no suggestions; the form carries on with the plain options.
 */
export function useSuggestions(enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, SuggestEntry>>({});
  const asked = useRef(new Set<string>());

  const request = useCallback(
    (field: SuggestField, story: string, tribe?: string) => {
      const text = story.trim();
      if (!enabled || text.length < 12) return;
      if (field === "season_goal" && !tribe) return;
      const key = suggestionKey(field, text, tribe);
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setEntries((e) => ({ ...e, [key]: { status: "loading", items: [] } }));

      fetch("/api/intake/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, story: text, tribe }),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8000) : undefined,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((data: { suggestions?: SuggestedItem[] }) => {
          const items = Array.isArray(data.suggestions)
            ? data.suggestions
                .filter((s) => typeof s?.id === "string")
                .map((s) => ({ id: s.id, reason: typeof s.reason === "string" ? s.reason : "" }))
            : [];
          setEntries((e) => ({ ...e, [key]: { status: "ready", items } }));
        })
        .catch(() => setEntries((e) => ({ ...e, [key]: { status: "ready", items: [] } })));
    },
    [enabled],
  );

  const get = useCallback(
    (field: SuggestField, story: string, tribe?: string): SuggestEntry | null =>
      entries[suggestionKey(field, story, tribe)] ?? null,
    [entries],
  );

  return { request, get };
}
