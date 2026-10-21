import { isRole, ROLE_LABELS } from "@/lib/auth/roles";
import { flat, smsLine } from "./format";
import type { Params, TemplateDef } from "./types";

/**
 * The email an invited person gets. Before this, inviting someone saved the invitation and told nobody.
 *
 * Two cases, one template:
 *   - the address has no account yet (or has not verified it): the email says what the role is, to sign in with THIS address, and that
 *     nothing happens until they do
 *   - the address already has an account: the role is already on it, and the email says so
 *
 * Rules the wording keeps, and the tests check:
 *   - it comes from the church office. It never names the person who invited, and never the owner
 *   - it carries no secret and no link that works as a key: signing in with the address is the whole proof, as it was before
 *   - email only: it is never put to Meta for approval, and the database queues it as email
 */

/** "a tribe leader", "an admin". The role comes from the database as its key; anything unknown reads as a plain "role". */
export function roleWithArticle(role: unknown): string {
  const label = isRole(role) ? ROLE_LABELS[role].toLowerCase() : "";
  if (!label) return "a role";
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}

const existing = (p: Params) => p.existing === true;

const roleInvitation: TemplateDef = {
  key: "role_invitation",
  audience: "invitee",
  title: "Someone is invited to serve, or has been given a role",
  emailOnly: true,
  email: (p, c) => {
    const role = roleWithArticle(p.role);
    if (existing(p)) {
      return {
        subject: `You are now ${role} on United Tribes`,
        greeting: `Hi ${c.first},`,
        paragraphs: [
          `The church office at The Covenant Nation has made you ${role} on United Tribes. The role is already on your account.`,
          "Sign in to see what has changed for you. If this was not expected, please tell the office.",
        ],
        cta: { label: "Open United Tribes", url: c.link("/sign-in") },
      };
    }
    return {
      subject: `You are invited to serve on United Tribes as ${role}`,
      greeting: "Hello,",
      paragraphs: [
        `The church office at The Covenant Nation has invited you to serve on United Tribes as ${role}.`,
        "To accept, sign in with this email address, the one this message was sent to. Your role is added the first time you do. If you sign in with a different address, nothing is added.",
        `The invitation stays open for ${Math.max(1, Math.round(Number(p.days) || 30))} days. If you were not expecting it, you can ignore this message: nothing happens unless you sign in.`,
      ],
      cta: { label: "Sign in", url: c.link("/sign-in") },
    };
  },
  sms: (p, c) =>
    smsLine(
      existing(p)
        ? `United Tribes: you are now ${roleWithArticle(p.role)}. Sign in to see what has changed:`
        : `United Tribes: you are invited to serve as ${roleWithArticle(p.role)}. Sign in with the email address we wrote to:`,
      c.link("/sign-in"),
    ),
  whatsapp: (p, c) => ({
    body: "Hello, the church office has {{1}} {{2}} on United Tribes. Sign in here: {{3}}",
    example: ["invited you to serve as", "a tribe leader", "https://unitedtribes.example/sign-in"],
    vars: [flat(existing(p) ? "made you" : "invited you to serve as"), flat(roleWithArticle(p.role)), flat(c.link("/sign-in"))],
  }),
};

export const INVITATION_TEMPLATES: TemplateDef[] = [roleInvitation];

/** Believable fields for the template, as the database supplies them. Used by the tests. */
export const INVITATION_SAMPLES: Record<string, Params> = {
  role_invitation: { role: "leader", existing: false, days: 30 },
};
