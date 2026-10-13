"use client";

import { useCallback, useRef, useState } from "react";
import { HEARD_FIELDS, type HeardField } from "@/lib/intake/heard";
import { SUCCESS_MAX, plainSuccessDraft } from "@/lib/intake/success";

export type SuggestField = "community" | "season_goal" | "group_roles";
/** What the person has confirmed so far, so a later question is asked with more to go on. */
export type KnownFacts = { workStatus?: string; workField?: string; relationship?: string; children?: readonly string[] };
export type SuggestedItem = { id: string; reason: string };
export type SuggestEntry = { status: "loading" | "ready"; items: SuggestedItem[] };

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Empty when nothing has been confirmed, so a story-only request keeps its old key. */
export function knownKey(known?: KnownFacts): string {
  if (!known) return "";
  const parts = [known.workStatus, known.workField, known.relationship, ...[...(known.children ?? [])].sort()].filter(Boolean);
  return parts.length === 0 ? "" : hash(parts.join("|"));
}

export function suggestionKey(field: SuggestField, story: string, community?: string, known?: KnownFacts) {
  const k = knownKey(known);
  return `${field}|${community ?? ""}|${hash(story.trim())}${k ? `|${k}` : ""}`;
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
    (field: SuggestField, story: string, community?: string, known?: KnownFacts) => {
      const text = story.trim();
      const facts = [known?.workStatus, known?.workField, known?.relationship, ...(known?.children ?? [])].filter(Boolean).length;
      if (!enabled || (text.length < 12 && facts < 2)) return;
      if (field === "season_goal" && !community) return;
      const key = suggestionKey(field, text, community, known);
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setEntries((e) => ({ ...e, [key]: { status: "loading", items: [] } }));

      fetch("/api/intake/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, story: text, community, known: knownKey(known) ? known : undefined }),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(9000) : undefined,
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

  /** The answer asked with the confirmed facts, if it has come back with something; otherwise the story-only one. */
  const get = useCallback(
    (field: SuggestField, story: string, community?: string, known?: KnownFacts): SuggestEntry | null => {
      const plain = entries[suggestionKey(field, story, community)] ?? null;
      if (!knownKey(known)) return plain;
      const richer = entries[suggestionKey(field, story, community, known)] ?? null;
      if (richer?.status === "ready" && richer.items.length > 0) return richer;
      return plain ?? richer;
    },
    [entries],
  );

  /** Whether any question is still waiting on the assistant. */
  const waiting = Object.values(entries).some((e) => e.status === "loading");

  return { request, get, waiting };
}

export type HeardEntry = {
  status: "loading" | "ready";
  /** What the assistant heard, by question. Empty when it heard nothing or could not be asked. */
  fields: Partial<Record<HeardField, SuggestedItem[]>>;
};

/**
 * The "We heard…" chips: one request that answers four small questions about the same story. Like the
 * suggestions above, it runs in the background and a failure just means no chips.
 */
export function useHeard(enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, HeardEntry>>({});
  const asked = useRef(new Set<string>());

  const request = useCallback(
    (story: string) => {
      const text = story.trim();
      if (!enabled || text.length < 12) return;
      const key = hash(text);
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setEntries((e) => ({ ...e, [key]: { status: "loading", fields: {} } }));

      fetch("/api/intake/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: "heard", story: text }),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10000) : undefined,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((data: { fields?: Record<string, unknown> }) => {
          const fields: HeardEntry["fields"] = {};
          for (const field of HEARD_FIELDS) {
            const list = data.fields?.[field];
            if (!Array.isArray(list)) continue;
            fields[field] = list
              .filter((s): s is SuggestedItem => typeof (s as SuggestedItem)?.id === "string")
              .map((s) => ({ id: s.id, reason: typeof s.reason === "string" ? s.reason : "" }));
          }
          setEntries((e) => ({ ...e, [key]: { status: "ready", fields } }));
        })
        .catch(() => setEntries((e) => ({ ...e, [key]: { status: "ready", fields: {} } })));
    },
    [enabled],
  );

  const get = useCallback((story: string): HeardEntry | null => entries[hash(story.trim())] ?? null, [entries]);
  return { request, get };
}

export type DraftState = { status: "idle" | "loading" | "ready"; text: string; ai: boolean };

/**
 * The drafted week-12 sentence. With the assistant on it is written from the person's goal and story; otherwise (or if the
 * assistant is slow or fails) it is the plain starting sentence built from the goal. Either way there is something to edit.
 */
export function useSuccessDraft(assistantOn: boolean) {
  const [state, setState] = useState<DraftState>({ status: "idle", text: "", ai: false });
  const lastKey = useRef("");

  const request = useCallback(
    (input: { story: string; goal?: string; goalOther?: string; title?: string | null }) => {
      const own = input.goalOther?.trim() || null;
      const plain = plainSuccessDraft({ title: input.title, own: input.title ? null : own });
      if (!plain) return;
      const key = `${input.goal ?? ""}|${own ?? ""}|${assistantOn ? hash(input.story.trim()) : "plain"}`;
      if (lastKey.current === key) return;
      lastKey.current = key;

      if (!assistantOn || !input.story.trim()) {
        setState({ status: "ready", text: plain, ai: false });
        return;
      }
      setState({ status: "loading", text: "", ai: false });
      fetch("/api/intake/success", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: input.story.trim() || undefined, goal: input.goal, goalOther: input.goal ? undefined : own ?? undefined }),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(9000) : undefined,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((data: { text?: string; ai?: boolean }) => {
          const text = typeof data.text === "string" && data.text.trim() ? data.text.trim().slice(0, SUCCESS_MAX) : plain;
          setState({ status: "ready", text, ai: data.ai === true && text !== plain });
        })
        .catch(() => setState({ status: "ready", text: plain, ai: false }));
    },
    [assistantOn],
  );

  return { state, request };
}
