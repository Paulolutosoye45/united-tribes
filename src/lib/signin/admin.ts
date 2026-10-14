/**
 * What the WhatsApp sign-in page for the office reads (signin_admin_overview), and every sentence it says about it.
 * The database builds the data and checks who may see and change it; this only reads it safely and puts it in words.
 */

export type SigninSettings = {
  whatsapp_on: boolean;
  mode: "normal" | "reply_first";
  cap_number_15m: number;
  cap_number_day: number;
  gap_1_s: number;
  gap_2_s: number;
  gap_3_s: number;
  cap_network_hour: number;
  cap_channel_hour: number;
  cap_channel_day: number;
  require_screen: boolean;
  breaker_window_min: number;
  breaker_min_sends: number;
  breaker_fail_pct: number;
  breaker_receipt_grace_min: number;
  breaker_no_receipt_pct: number;
  breaker_stop_count: number;
  code_minutes: number;
  breaker_state: "ok" | "tripped";
  breaker_reason: string | null;
  breaker_tripped_at: string | null;
  sender_signal: "unknown" | "ok" | "logged_out" | "restricted" | "unreachable";
  sender_checked_at: string | null;
  updated_at: string | null;
};

export type SigninDay = { day: string; asked: number; delivered: number; failed: number; declined: number; not_collected: number };
export type SigninEvent = { id: number; at: string; kind: string; reason: string | null; detail: Record<string, unknown>; by: string | null };

export type SigninOverview = {
  status: "on" | "off" | "paused";
  settings: SigninSettings;
  can_raise: boolean;
  now: { hour: number; day: number };
  blocks_active: number;
  daily: SigninDay[];
  events: SigninEvent[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function readOverview(value: unknown): SigninOverview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SigninOverview>;
  if (!v.settings || (v.status !== "on" && v.status !== "off" && v.status !== "paused")) return null;
  return {
    status: v.status,
    settings: v.settings,
    can_raise: v.can_raise === true,
    now: { hour: num(v.now?.hour), day: num(v.now?.day) },
    blocks_active: num(v.blocks_active),
    daily: Array.isArray(v.daily)
      ? v.daily.map((d) => ({ day: String(d.day), asked: num(d.asked), delivered: num(d.delivered), failed: num(d.failed), declined: num(d.declined), not_collected: num(d.not_collected) }))
      : [],
    events: Array.isArray(v.events) ? v.events.map((e) => ({ id: num(e.id), at: String(e.at), kind: String(e.kind), reason: e.reason ?? null, detail: (e.detail ?? {}) as Record<string, unknown>, by: e.by ?? null })) : [],
  };
}

/** Why the breaker pauses WhatsApp, in plain words (the same wording as the email the director and data lead are sent). */
export const TRIP_REASONS: Record<string, string> = {
  failed_sends: "too many WhatsApp codes failed to send",
  rejections: "WhatsApp refused too many codes",
  no_receipts: "most recent codes show no sign of arriving",
  stop_spike: "several people replied STOP or “not me”",
  sender_logged_out: "the sending number was logged out of WhatsApp",
  sender_restricted: "WhatsApp restricted the sending number",
  sender_unreachable: "the sending service could not be reached for a while",
};
export const tripReason = (reason: string | null) => (reason && TRIP_REASONS[reason]) || "something looked wrong";

/** What to look at first for each reason, so the person restarting it has somewhere to begin. */
export const TRIP_ADVICE: Record<string, string> = {
  failed_sends: "Check the sending service (or the Meta dashboard) for errors, ask for a test code to a number you hold, then restart.",
  rejections: "WhatsApp is refusing messages. Open the Meta dashboard (official route) or look at the sender’s log (ordinary number). Do not restart until you know why.",
  no_receipts: "Codes are leaving but nothing is confirmed as arriving. Check the phone is online and WhatsApp is open on it, and that the number is not restricted.",
  stop_spike: "People are telling the number to stop. Look at what was sent and to whom, and consider staying on email for a while.",
  sender_logged_out: "Open WhatsApp on the sign-in phone, and link the number again (see sender/README.md). Then restart.",
  sender_restricted: "WhatsApp has limited the number. Restarting will not change that. Stay on email, or switch to the official route.",
  sender_unreachable: "The sending service did not answer. Check the server and its address (LINKED_SENDER_URL), then restart.",
};

export const SENDER_SIGNAL_LABEL: Record<SigninSettings["sender_signal"], string> = {
  unknown: "Not reported yet",
  ok: "Connected",
  logged_out: "Logged out of WhatsApp",
  restricted: "Restricted by WhatsApp",
  unreachable: "Not answering",
};

export type LimitKey =
  | "cap_number_15m"
  | "cap_number_day"
  | "gap_1_s"
  | "gap_2_s"
  | "gap_3_s"
  | "cap_network_hour"
  | "cap_channel_hour"
  | "cap_channel_day"
  | "code_minutes"
  | "breaker_window_min"
  | "breaker_min_sends"
  | "breaker_fail_pct"
  | "breaker_receipt_grace_min"
  | "breaker_no_receipt_pct"
  | "breaker_stop_count";

export type LimitInfo = { key: LimitKey; label: string; help: string; min: number; max: number; unit: string; fallback: number; raises?: boolean };

/** The limits on codes. The database repeats each range; these are what the form shows and checks before it asks. */
export const LIMITS: LimitInfo[] = [
  { key: "cap_number_15m", label: "Codes to one number in 15 minutes", help: "A person who keeps asking is stopped here. Three is plenty for someone who really is signing in.", min: 1, max: 10, unit: "codes", fallback: 3 },
  { key: "cap_number_day", label: "Codes to one number in a day", help: "Counted over the last 24 hours.", min: 1, max: 30, unit: "codes", fallback: 8 },
  { key: "gap_1_s", label: "Wait before the second code", help: "The sign-in screen counts this down, so nobody presses a button that would be ignored.", min: 0, max: 3600, unit: "seconds", fallback: 60 },
  { key: "gap_2_s", label: "Wait before the third code", help: "", min: 0, max: 3600, unit: "seconds", fallback: 120 },
  { key: "gap_3_s", label: "Wait before any later code", help: "", min: 0, max: 3600, unit: "seconds", fallback: 300 },
  { key: "cap_network_hour", label: "Codes asked from one connection in an hour", help: "A connection is a network address, kept only as a scrambled code. A church hall on one wifi shares one, so do not set this too low for an event.", min: 1, max: 500, unit: "codes", fallback: 12 },
  { key: "cap_channel_hour", label: "All WhatsApp codes in an hour", help: "The ceiling for the whole church. Only the director can raise it; anyone here can lower it.", min: 1, max: 2000, unit: "codes", fallback: 20, raises: true },
  { key: "cap_channel_day", label: "All WhatsApp codes in a day", help: "Only the director can raise this.", min: 1, max: 20000, unit: "codes", fallback: 150, raises: true },
  { key: "code_minutes", label: "How long a waiting code is kept", help: "Reply-first only. Keep it the same as the code’s life in Supabase (ten minutes).", min: 3, max: 60, unit: "minutes", fallback: 10 },
];

/** What makes the breaker pause WhatsApp by itself. */
export const BREAKER_LIMITS: LimitInfo[] = [
  { key: "breaker_window_min", label: "How far back it looks", help: "", min: 10, max: 240, unit: "minutes", fallback: 30 },
  { key: "breaker_min_sends", label: "Fewest codes before it judges", help: "Below this it says nothing, so one bad code cannot pause everything.", min: 3, max: 100, unit: "codes", fallback: 5 },
  { key: "breaker_fail_pct", label: "Pause when this many failed or were refused", help: "A share of the codes in that time.", min: 10, max: 100, unit: "%", fallback: 50 },
  { key: "breaker_receipt_grace_min", label: "Wait for a delivery receipt", help: "Ordinary number only. A code with no receipt after this long counts as “no sign of arriving”.", min: 1, max: 30, unit: "minutes", fallback: 3 },
  { key: "breaker_no_receipt_pct", label: "Pause when this many show no receipt", help: "Ordinary number only.", min: 20, max: 100, unit: "%", fallback: 70 },
  { key: "breaker_stop_count", label: "Pause when this many say STOP or “not me”", help: "In that time.", min: 1, max: 50, unit: "people", fallback: 3 },
];

export const MODE_CHOICES: { id: "reply_first" | "normal"; title: string; body: string }[] = [
  {
    id: "reply_first",
    title: "Reply first (safer for an ordinary number)",
    body: "The person messages the sign-in number first, and the number replies with the code. This is how WhatsApp expects an ordinary number to be used, and it is the way to start.",
  },
  {
    id: "normal",
    title: "Send at once",
    body: "The code is sent as soon as it is asked for. Simpler for people, but an ordinary number that messages people who have not written to it is more likely to be restricted. Only change to this once reply first has run well for a while.",
  },
];

const dayFormat = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
const timeFormat = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
export const shortDay = (day: string) => {
  const parsed = new Date(`${day.slice(0, 10)}T12:00:00+01:00`);
  return Number.isNaN(parsed.getTime()) ? day : dayFormat.format(parsed);
};
export const whenText = (iso: string | null) => {
  const parsed = iso ? new Date(iso) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? timeFormat.format(parsed) : "";
};

/** One line for the log of trips and changes. */
export function eventLine(e: SigninEvent): { title: string; body: string | null } {
  const who = e.by ? ` by ${e.by}` : "";
  switch (e.kind) {
    case "tripped":
      return { title: "WhatsApp paused itself", body: `Because ${tripReason(e.reason)}.` };
    case "reset":
      return { title: `WhatsApp restarted${who}`, body: e.reason ? `Note: ${e.reason}` : null };
    case "switch_on":
      return { title: `WhatsApp codes switched on${who}`, body: null };
    case "switch_off":
      return { title: `WhatsApp codes switched off${who}`, body: null };
    case "mode":
      return { title: `Way of sending changed${who}`, body: e.reason === "normal" ? "Now: send at once." : "Now: reply first." };
    case "settings": {
      const names = Object.keys(e.detail)
        .map((k) => [...LIMITS, ...BREAKER_LIMITS].find((l) => l.key === k)?.label ?? (k === "require_screen" ? "Only codes asked for on our screen" : null))
        .filter((n): n is string => Boolean(n));
      return { title: `Limits changed${who}`, body: names.length > 0 ? names.join(", ") : null };
    }
    default:
      return { title: "Changed", body: null };
  }
}

/** The tallest day, for scaling the chart. Never zero. */
export const chartMax = (days: SigninDay[]) => Math.max(1, ...days.map((d) => d.asked));
