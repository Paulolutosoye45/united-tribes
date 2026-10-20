import path from "node:path";
import { anonKey } from "../scripts/standin/server";
import { SIGNIN, TURNSTILE } from "./stubs";

export { SIGNIN };

/** Fixed on purpose: the stand-in and the built app must agree on the key. */
export const JWT_SECRET = "standin-secret-not-for-real-use-0123456789abcdef";
export const API_PORT = Number(process.env.E2E_API_PORT ?? 54321);
export const APP_PORT = Number(process.env.E2E_PORT ?? 3100);
export const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 54399);
export const STATE_FILE = path.resolve(__dirname, "../.e2e/stack.json");

/** What the built app needs. NEXT_PUBLIC_ values are baked in at build time, so the build gets them too. */
export function appEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey(JWT_SECRET),
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${APP_PORT}`,
    // The bot check is on for every journey, against the stand-in widget (baked in at build time like the others)
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE.siteKey,
    NEXT_PUBLIC_TURNSTILE_SCRIPT_URL: `http://127.0.0.1:${STUB_PORT}/turnstile/api.js`,
  };
}

/** The server half of the bot check: where to ask, and the secret to ask with (read at run time). */
export function securityEnv(stubUrl: string): Record<string, string> {
  return { TURNSTILE_SECRET_KEY: TURNSTILE.secret, TURNSTILE_VERIFY_URL: `${stubUrl}/turnstile/siteverify` };
}

/** Secrets the app and the journeys share for the message providers' stand-ins. Not real: for the throwaway stack only. */
export const MESSAGING = {
  cronSecret: "e2e-cron-secret-0123456789abcdef",
  appSecret: "e2e-whatsapp-app-secret",
  verifyToken: "e2e-whatsapp-verify-token",
  emailWebhookSecret: `whsec_${Buffer.from("e2e-email-webhook-secret").toString("base64")}`,
} as const;

/** What the running app needs for WhatsApp sign-in: on, through the ordinary-number sender stand-in, with the hook secret. */
export function signinEnv(stubUrl: string): Record<string, string> {
  return {
    WHATSAPP_SIGNIN: "on",
    SIGNIN_WHATSAPP_ROUTE: "linked",
    LINKED_SENDER_URL: `${stubUrl}/linked`,
    LINKED_SENDER_SECRET: SIGNIN.linkedSecret,
    WHATSAPP_SIGNIN_NUMBER: SIGNIN.number,
    SEND_SMS_HOOK_SECRET: SIGNIN.hookSecret,
  };
}

/**
 * The assistant, the voice-note transcriber and the key that seals private notes, for the throwaway stack.
 * The assistant and transcriber are the word-matching stand-ins; the key is not real and protects nothing.
 */
export const SEALING_KEY = `e2e1:${Buffer.from("e2e-sealing-key-0123456789abcdef").toString("base64")}`;
export function intakeEnv(): Record<string, string> {
  return { AI_PROVIDER: "mock", STT_PROVIDER: "mock", DATA_ENCRYPTION_KEYS: SEALING_KEY };
}

/** What the running app needs to send messages through the stand-ins (read at run time, not build time). */
export function messagingEnv(workerToken: string, stubUrl: string): Record<string, string> {
  return {
    WORKER_TOKEN: workerToken,
    CRON_SECRET: MESSAGING.cronSecret,
    WHATSAPP_PROVIDER: "meta",
    WHATSAPP_PHONE_NUMBER_ID: "100200300",
    WHATSAPP_ACCESS_TOKEN: "wa_e2e_token",
    WHATSAPP_API_BASE: stubUrl,
    WHATSAPP_APP_SECRET: MESSAGING.appSecret,
    WHATSAPP_VERIFY_TOKEN: MESSAGING.verifyToken,
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_e2e",
    EMAIL_FROM: "United Tribes <hello@unitedtribes.example>",
    RESEND_API_BASE: stubUrl,
    EMAIL_WEBHOOK_SECRET: MESSAGING.emailWebhookSecret,
    SMS_PROVIDER: "termii",
    TERMII_API_KEY: "tm_e2e",
    TERMII_SENDER_ID: "UnitedTribes",
    TERMII_BASE_URL: stubUrl,
  };
}

if (process.argv[1]?.endsWith("env.ts") && process.argv.includes("--print")) {
  for (const [k, v] of Object.entries(appEnv())) console.log(`export ${k}=${v}`);
}
