/**
 * Sends one real test email through whatever email provider the settings choose, and says plainly what happened.
 *
 *   npm run email:test -- you@example.org
 *
 * Reads the settings from the environment or from .env.local (EMAIL_PROVIDER=smtp and the SMTP_* lines, or Resend). It sends the same
 * "welcome" email a new member receives, so you see the real design, the real From and Reply-To, and whether it lands in the inbox or in
 * spam. Nothing is written to the database and nobody else is emailed.
 *
 * What to check afterwards, in the received message (Gmail: "Show original"):  SPF: PASS   DKIM: PASS   DMARC: PASS
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { providersFromEnv } from "../src/lib/messaging/providers";
import type { ClaimedMessage } from "../src/lib/messaging/types";

function loadEnvFile() {
  const file = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** What is missing, in the words of the setting, so nobody has to read code to find out. */
function whatIsMissing(env: NodeJS.ProcessEnv): string[] {
  const has = (k: string) => Boolean((env[k] ?? "").trim());
  const which = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const out: string[] = [];
  if (!which) out.push("EMAIL_PROVIDER is not set (use smtp, or resend)");
  else if (which === "smtp") {
    if (!has("SMTP_HOST")) out.push("SMTP_HOST is empty");
    if (!has("EMAIL_FROM")) out.push("EMAIL_FROM is empty");
    if (has("SMTP_USER") && !has("SMTP_PASSWORD")) out.push("SMTP_USER is set but SMTP_PASSWORD is empty");
    const port = (env.SMTP_PORT ?? "").trim();
    if (port && !(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535)) out.push(`SMTP_PORT "${port}" is not a port number`);
  } else if (which === "resend") {
    if (!has("RESEND_API_KEY")) out.push("RESEND_API_KEY is empty");
    if (!has("EMAIL_FROM")) out.push("EMAIL_FROM is empty");
  } else if (which !== "log") out.push(`EMAIL_PROVIDER "${which}" is not one of smtp, resend, log`);
  if ((env.MESSAGING_MODE ?? "").trim().toLowerCase() === "log") out.push("MESSAGING_MODE=log is set, which only writes messages to the log; remove it to send for real");
  return out;
}

async function main() {
  loadEnvFile();
  const to = (process.argv[2] ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Usage: npm run email:test -- you@example.org");
    process.exit(2);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim() || "https://example.org";
  const email = providersFromEnv().email;
  if (!email) {
    console.error("No email provider is set up.");
    for (const line of whatIsMissing(process.env)) console.error(`  - ${line}`);
    process.exit(1);
  }

  const message: ClaimedMessage = {
    id: crypto.randomUUID(),
    template: "welcome",
    channel: "email",
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    params: {
      first_name: "friend",
      tribe: "the test tribe",
      leader: "Your leader",
      leader_first: "Your leader",
      meeting_day: 3,
      meeting_time: "20:00",
      mode: "online",
      meeting_link: "https://meet.example.org/test",
      group_url: "https://chat.whatsapp.com/test",
      starts_on: "2027-02-14",
    },
    to: { email: to, phone: null, name: "Test Recipient", first_name: "friend" },
  };

  console.log(`Sending a test email to ${to} through "${email.name}"…`);
  const started = Date.now();
  const result = await email.send(message, site);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.ok) {
    console.log(`The server accepted it in ${seconds}s${result.providerId ? ` (id ${result.providerId})` : ""}.`);
    console.log("Now open it: check the inbox AND the spam folder, then look at the original message for SPF / DKIM / DMARC = PASS.");
    process.exit(0);
  }
  console.error(`Not sent (${result.kind === "retry" ? "a temporary fault: the platform would try again later" : "refused: the platform would not try this one again by email"}):`);
  console.error(`  ${result.error}`);
  if (/login refused/.test(result.error)) console.error("  Check SMTP_USER and SMTP_PASSWORD (some servers want the full address as the user name).");
  if (/unreachable/.test(result.error)) console.error("  Check SMTP_HOST and SMTP_PORT, that this computer can reach that port, and that the server's certificate matches SMTP_HOST.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
