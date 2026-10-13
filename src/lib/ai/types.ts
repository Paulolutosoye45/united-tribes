/** One choice the member could pick. The assistant may only ever name these. */
export type Option = { id: string; label: string };

export type SuggestRequest = {
  /** Which form field this is for. Only fields in sensitive.ts's allow-list may be sent. */
  field: string;
  /** The question the member is answering, in the member's words. */
  question: string;
  /** The closed set of valid answers. Suggestions outside it are discarded. */
  options: Option[];
  /** What the member has written so far, in their own words. */
  story: string;
  /** Facts the member has already confirmed about themselves, one short line each ("Work: Employed"). Nothing painful or private. */
  known?: string[];
  /** How many suggestions to return at most. */
  max?: number;
};

export type Suggestion = {
  id: string;
  /** One short line shown under the option, quoting or paraphrasing the member. */
  reason: string;
};

/** What a provider returns before we check it. */
export type RawSuggestions = {
  suggestions: { id: string; reason?: string }[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  suggest(input: ProviderInput, signal: AbortSignal): Promise<RawSuggestions>;
  /** Plain writing, for short summaries and drafts. See write.ts for the rules around it. */
  write(input: WriteInput, signal: AbortSignal): Promise<RawText>;
}

export type WriteInput = {
  system: string;
  user: string;
  /** A plain draft written without AI. The mock provider returns it; real ones may only reword it. */
  draft: string;
  maxTokens: number;
};

export type RawText = { text: string; usage?: RawSuggestions["usage"] };

export type ProviderInput = {
  system: string;
  user: string;
  optionIds: string[];
  max: number;
};

export type FallbackReason =
  | "no_provider"
  | "too_short"
  | "timeout"
  | "error"
  | "not_allowed"
  | "no_consent"
  | "rate_limited";

export type SuggestResult = {
  suggestions: Suggestion[];
  /** True when the form should carry on with the plain options only. */
  fallback: boolean;
  reason?: FallbackReason;
  provider: string;
  model: string;
  latencyMs: number;
  /** Picks the model made that were not in the option list. They are dropped. */
  dropped: number;
  usage?: RawSuggestions["usage"];
};
