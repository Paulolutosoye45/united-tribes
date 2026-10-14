import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

/** What the database says about a link from one of our emails. Nothing private: a first name and a hint of the address. */
export type LinkInfo = {
  found: boolean;
  kind?: "go" | "stop" | "prefs" | "ask";
  scope?: string;
  expired?: boolean;
  used?: boolean;
  first_name?: string;
  email_hint?: string;
  journey?: string | null;
  journey_title?: string | null;
  step?: string | null;
  switches?: { reminders: boolean; announcements: boolean; tribe: boolean };
};

/** A link token is 64 hex characters. Anything else is not one of ours. */
export const isLinkToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function openLink(token: string): Promise<LinkInfo | null> {
  const secret = workerToken();
  if (!isLinkToken(token) || !secret || !getSupabaseEnv()) return null;
  try {
    const { data, error } = await workerRpc(secret)("worker_link_open", { p_link: token });
    if (error) return null;
    return (data as LinkInfo | null) ?? null;
  } catch {
    return null;
  }
}
