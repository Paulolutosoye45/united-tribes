import type { Church, Progress } from "./compose";

/**
 * The look of a United Tribes email. Plain tables and inline styles, because that is what every mail program understands.
 * What makes it feel alive: a progress shield that shows exactly where the person stopped, a card with the tribe or the next
 * gathering, a large button that works even in Outlook, a preview line, and a dark mode.
 */

const C = { charcoal: "#2e2e2b", flame: "#e86838", gold: "#f4c443", amber: "#e89838", night: "#232321", paper: "#fbf8f3", ink: "#1a1917", rule: "#e8e1d6", soft: "#6b665e", white: "#ffffff" } as const;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Only https links (and a local address while developing). Anything else is dropped, so a message can never lead off-site by mistake. */
export const safeHref = (url: string) => (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) ? url : "");

export type Hero =
  | { kind: "progress"; progress: Progress; label: string }
  | { kind: "tribe"; name: string; leader: string; seats: number; starts: string }
  | { kind: "gathering"; name: string; when: string; leader: string }
  /** The placed-member nudge: the tribe the church placed them in, when it meets and who leads it. No answers, no scores, no other members. */
  | { kind: "held"; name: string; when: string; leader: string };

export type DesignSpec = {
  subject: string;
  preheader: string;
  tone?: string;
  greeting?: string;
  paragraphs: string[];
  hero?: Hero;
  button?: { label: string; url: string };
  /** Smaller pill buttons under the main one: the ways out at the foot of the last email. */
  options?: { label: string; url: string }[];
  /** Said just under the button, in small type, such as "Takes about 3 minutes". */
  note?: string;
  church: Church;
  /** Why they are getting it, in a sentence. */
  why: string;
  stopLabel: string;
  stopUrl: string;
  prefsUrl: string;
};

const shield = (p: Progress) => {
  const cell = (fill: number, last: boolean) => {
    const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
    const rest = 100 - pct;
    return `<td width="25%" style="padding:0 ${last ? 0 : 4}px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${
      pct > 0 ? `<td width="${pct}%" height="10" bgcolor="${C.flame}" style="background:${C.flame};height:10px;line-height:10px;font-size:0;border-radius:5px 0 0 5px">&nbsp;</td>` : ""
    }${rest > 0 ? `<td width="${rest}%" height="10" class="ut-track" bgcolor="${C.rule}" style="background:${C.rule};height:10px;line-height:10px;font-size:0;border-radius:${pct > 0 ? "0 5px 5px 0" : "5px"}">&nbsp;</td>` : ""}</tr></table></td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${p.fills.map((f, i) => cell(f, i === 3)).join("")}</tr></table>`;
};

function heroHtml(h: Hero | undefined): string {
  if (!h) return "";
  const box = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ut-card" style="margin:6px 0 20px;background:${C.paper};border:1px solid ${C.rule};border-radius:12px"><tr><td style="padding:16px 18px">${inner}</td></tr></table>`;
  if (h.kind === "progress") {
    return box(
      `<p class="ut-soft" style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.soft}">${esc(h.label)}</p>` +
        shield(h.progress) +
        `<p style="margin:12px 0 0;font-size:15px;line-height:1.45"><strong>${h.progress.percent}% there</strong> <span class="ut-soft" style="color:${C.soft}">· you stopped in “${esc(h.progress.section)}” · about ${h.progress.minutes} min left</span></p>`,
    );
  }
  if (h.kind === "tribe") {
    return box(
      `<p class="ut-soft" style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.soft}">Your best match</p>` +
        `<p style="margin:0 0 6px;font-size:21px;line-height:1.25;font-weight:800">${esc(h.name)}</p>` +
        `<p style="margin:0;font-size:15px;line-height:1.55">Led by ${esc(h.leader)}<br>${h.seats > 0 ? `<strong style="color:${C.flame}">${h.seats} seat${h.seats === 1 ? "" : "s"} left</strong>` : "Full for now"} · season starts ${esc(h.starts)}</p>`,
    );
  }
  if (h.kind === "held") {
    return box(
      `<p class="ut-soft" style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.soft}">Your place is held</p>` +
        `<p style="margin:0 0 6px;font-size:21px;line-height:1.25;font-weight:800">${esc(h.name)}</p>` +
        `<p style="margin:0;font-size:15px;line-height:1.55">${esc(h.when)} · with ${esc(h.leader)}</p>`,
    );
  }
  return box(
    `<p class="ut-soft" style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.soft}">Your next gathering</p>` +
      `<p style="margin:0 0 6px;font-size:21px;line-height:1.25;font-weight:800">${esc(h.when)}</p>` +
      `<p style="margin:0;font-size:15px;line-height:1.55">${esc(h.name)} · with ${esc(h.leader)}</p>`,
  );
}

/** A button that is a real button in Outlook too (VML), and a rounded pill everywhere else. */
function bigButton(label: string, url: string): string {
  const href = esc(url);
  const text = esc(label);
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:52px;v-text-anchor:middle;width:300px" arcsize="50%" stroke="f" fillcolor="${C.flame}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" class="ut-btn" style="display:inline-block;padding:15px 30px;background:${C.flame};border-radius:999px;color:#ffffff;text-decoration:none;font-weight:800;font-size:17px;line-height:1.2;font-family:${FONT}">${text}</a><!--<![endif]-->`;
}

export function designedHtml(s: DesignSpec): string {
  const button = s.button && safeHref(s.button.url) ? s.button : undefined;
  const options = (s.options ?? []).filter((o) => safeHref(o.url));
  const address = s.church.address ? `${esc(s.church.name)}<br>${esc(s.church.address)}` : esc(s.church.name);
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(s.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  @media (max-width:520px){.ut-pad{padding:22px 18px !important}.ut-btn{display:block !important;text-align:center !important}.ut-opt{display:block !important;margin:0 0 10px !important;text-align:center !important}}
  @media (prefers-color-scheme:dark){
    body,.ut-bg{background:${C.night} !important}
    .ut-sheet{background:#2b2b28 !important;border-color:#3d3d39 !important}
    .ut-text,.ut-sheet p,.ut-sheet strong{color:#f1ede6 !important}
    .ut-soft{color:#b4aea3 !important}
    .ut-card{background:#232321 !important;border-color:#3d3d39 !important}
    .ut-track{background:#45443f !important}
    .ut-opt{border-color:#f1ede6 !important;color:#f1ede6 !important}
    .ut-foot,.ut-foot a{color:#b4aea3 !important}
  }
</style></head>
<body class="ut-bg" style="margin:0;padding:0;background:${C.paper};font-family:${FONT};color:${C.ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(s.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ut-bg" style="background:${C.paper}"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td bgcolor="${C.charcoal}" style="background:${C.charcoal};border-radius:999px;padding:7px 14px 7px 12px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ffffff"><span style="color:${C.flame};font-size:14px">●</span>&nbsp; United Tribes</td>
</tr></table></td></tr>
<tr><td class="ut-sheet ut-pad" style="background:${C.white};border:1px solid ${C.rule};border-radius:18px;padding:30px 28px;border-top:5px solid ${C.flame}">
${s.greeting ? `<p class="ut-text" style="margin:0 0 16px;font-size:20px;line-height:1.35;font-weight:800;color:${C.ink}">${esc(s.greeting)}</p>` : ""}
${s.paragraphs.map((p) => `<p class="ut-text" style="margin:0 0 15px;font-size:16px;line-height:1.65;color:${C.ink}">${esc(p)}</p>`).join("\n")}
${heroHtml(s.hero)}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 6px"><tr><td>${bigButton(button.label, button.url)}</td></tr></table>${s.note ? `<p class="ut-soft" style="margin:8px 0 0;font-size:13px;color:${C.soft}">${esc(s.note)}</p>` : ""}` : ""}
${options.length > 0 ? `<p class="ut-soft" style="margin:22px 0 10px;font-size:13px;color:${C.soft}">Or tell us what suits you better:</p><div>${options.map((o) => `<a href="${esc(o.url)}" class="ut-opt" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:2px solid ${C.charcoal};border-radius:999px;color:${C.charcoal};text-decoration:none;font-weight:700;font-size:14px">${esc(o.label)}</a>`).join("")}</div>` : ""}
</td></tr>
<tr><td class="ut-foot" style="padding:18px 10px 0;font-size:12px;line-height:1.7;color:${C.soft};text-align:center">
${esc(s.why)}<br>
<a href="${esc(s.stopUrl)}" style="color:${C.soft};text-decoration:underline">${esc(s.stopLabel)}</a> &nbsp;·&nbsp; <a href="${esc(s.prefsUrl)}" style="color:${C.soft};text-decoration:underline">Choose what we send</a><br>
<span style="font-size:11px">${address}</span>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function designedText(s: DesignSpec): string {
  const button = s.button && safeHref(s.button.url) ? s.button : undefined;
  const options = (s.options ?? []).filter((o) => safeHref(o.url));
  const hero =
    s.hero?.kind === "progress"
      ? `${s.hero.progress.percent}% there. You stopped in “${s.hero.progress.section}”, about ${s.hero.progress.minutes} min left.`
      : s.hero?.kind === "tribe"
        ? `Your best match: ${s.hero.name}, led by ${s.hero.leader}. ${s.hero.seats > 0 ? `${s.hero.seats} seat${s.hero.seats === 1 ? "" : "s"} left` : "Full for now"}. Season starts ${s.hero.starts}.`
        : s.hero?.kind === "held"
          ? `Your place is held: ${s.hero.name}, ${s.hero.when}, with ${s.hero.leader}.`
          : s.hero?.kind === "gathering"
            ? `Your next gathering: ${s.hero.when}, ${s.hero.name}, with ${s.hero.leader}.`
            : undefined;
  return [
    s.greeting,
    ...s.paragraphs,
    hero,
    button ? `${button.label}: ${button.url}` : undefined,
    s.note,
    options.length ? `Or tell us what suits you better:\n${options.map((o) => `- ${o.label}: ${o.url}`).join("\n")}` : undefined,
    `--\n${s.why}\n${s.stopLabel}: ${s.stopUrl}\nChoose what we send: ${s.prefsUrl}\n${s.church.name}${s.church.address ? `, ${s.church.address}` : ""}`,
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n\n");
}
