"use server";

import { redirect } from "next/navigation";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { DONE_OF, isAnswerKind, isAnswerLink, isReason, isWindow, parseAnswerResult } from "@/lib/placement/answers";
import { parseChoose } from "@/lib/placement/nudge";

const FUNCTIONS = { confirm: "worker_placed_confirm", withhold: "worker_placed_withhold", change: "worker_placed_change" } as const;
type Choice = keyof typeof FUNCTIONS;

/**
 * The three buttons on the page behind "Your tribe". Opening the link records nothing (a mail scanner or a link preview opens links
 * too); the member presses a button, and only then is it saved. The link is the only credential, so it is checked as 64 hex characters
 * here and again, hashed, in the database.
 */
export async function placedAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !(choice in FUNCTIONS)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);

  const rpc = workerRpc(secret);
  // "Yes, I’m in" may carry a number and the tick for WhatsApp (the contact series, when it is On). They are saved first, so a number that does not
  // look right stops here with the place still waiting; a member who left the boxes empty goes straight on.
  if (choice === "confirm") {
    const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
    const whatsapp = formData.get("whatsapp") === "on";
    const signin = formData.get("signin") === "on";
    if (phone || whatsapp || signin) {
      const saved = await rpc("worker_placed_reach_save", { p_link: token, p_phone: phone, p_whatsapp: whatsapp, p_use_signin: signin });
      if (saved.error) redirect(`/placed/${token}?${saved.error.code === "22023" ? "number=1" : "problem=1"}`);
    }
  }
  const args: Record<string, unknown> = { p_link: token };
  if (choice === "confirm") args.p_version = AGREEMENT_VERSION;
  const { data, error } = await rpc(FUNCTIONS[choice as Choice], args);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; late?: boolean };
  if (error) redirect(`/placed/${token}?problem=1`);
  if (!result.ok) {
    redirect(`/placed/${token}?${result.reason === "started" ? "started=1" : result.reason === "invalid" || result.reason === "not_active" ? "invalid=1" : "problem=1"}`);
  }
  redirect(`/placed/${token}?done=${choice}${result.late ? "&late=1" : ""}`);
}

/**
 * The two-button answer of the placed-member nudge: "Yes, I’m in, and message me on WhatsApp" or "Yes, I’m in, email only". One press, one
 * all-or-nothing step in the database: the place, the number, the WhatsApp yes (only from the first button) and the preference land together, and a number
 * that does not look right stops all of it. Opening the page saves nothing.
 */
export async function placedChooseAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || (mode !== "whatsapp" && mode !== "email")) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);

  const phone = mode === "whatsapp" ? String(formData.get("phone") ?? "").trim().slice(0, 40) : "";
  const signin = mode === "whatsapp" && formData.get("signin") === "on";
  const { data, error } = await workerRpc(secret)("worker_placed_choose", {
    p_link: token,
    p_mode: mode,
    p_phone: phone || null,
    p_use_signin: signin,
    p_version: AGREEMENT_VERSION,
  });
  if (error) redirect(`/placed/${token}?${error.code === "22023" ? "number=1" : "problem=1"}`);
  const result = parseChoose(data);
  if (!result.ok) {
    redirect(`/placed/${token}?${result.reason === "started" ? "started=1" : result.reason === "invalid" ? "invalid=1" : "problem=1"}`);
  }
  redirect(`/placed/${token}?done=confirm&m=${result.mode}${result.confirmed ? "&c=1" : ""}`);
}

/** "Send me a fresh link": for a link that ran out. The answer is the same whoever asks, so it tells nobody anything. */
export async function placedFreshLinkAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);
  const { error } = await workerRpc(secret)("worker_placed_new_link", { p_link: token });
  redirect(`/placed/${token}?${error ? "problem=1" : "fresh=1"}`);
}

/**
 * The other answers on the page: Not this season (with one optional reason chip), Call me (a time of day, and a number if we hold none), Remind me tonight, Stop
 * these reminders and Don't call me. Opening the page saves nothing; each is one press. The database decides whether the answer may be given (the switch, the seat,
 * the day) and says why not in a word; the page turns the word into a sentence. Everything sent is a choice from a short list, except the number.
 */
export async function placedAnswerAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!isAnswerLink(token) || !isAnswerKind(kind)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);

  const reason = String(formData.get("reason") ?? "");
  const window = String(formData.get("window") ?? "");
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const { data, error } = await workerRpc(secret)("worker_placed_answer", {
    p_link: token,
    p_kind: kind,
    p_reason: kind === "not_this_season" && isReason(reason) ? reason : null,
    p_window: kind === "call_me" && isWindow(window) ? window : null,
    p_topic: null,
    p_phone: kind === "call_me" && phone ? phone : null,
  });
  // A number that does not look right (22023) stops the request for a call and nothing is saved
  if (error) redirect(`/placed/${token}?${error.code === "22023" && kind === "call_me" ? "cn=1&a=call" : "problem=1"}`);
  const result = parseAnswerResult(data);
  if (!result.ok) {
    const why = (data ?? {}) as { reason?: string };
    redirect(
      `/placed/${token}?${
        why.reason === "started" ? "started=1" : result.reason === "invalid" || result.reason === "not_active" ? "invalid=1" : result.reason === "closed" || result.reason === "too_late" ? `rc=${result.reason}&a=remind` : "problem=1"
      }`,
    );
  }
  redirect(`/placed/${token}?done=${DONE_OF[result.kind]}${result.again ? "&again=1" : ""}${result.window ? `&w=${result.window}` : ""}`);
}
