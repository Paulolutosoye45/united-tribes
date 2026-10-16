import { BaileysTransport } from "./baileys.js";
import { SenderService } from "./core.js";

/**
 * Starts the sender. Settings come from the environment:
 *   SENDER_SECRET   the same long random text as LINKED_SENDER_SECRET on the website (at least 24 characters)
 *   APP_URL         the website's address, such as https://unitedtribes.example
 *   PORT            where to listen (default 8080). Put HTTPS in front of it: the code travels in the request.
 *   AUTH_DIR        where the WhatsApp login is kept (default ./auth)
 */
const secret = (process.env.SENDER_SECRET ?? "").trim();
const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const port = Number(process.env.PORT ?? 8080);
if (secret.length < 24) throw new Error("SENDER_SECRET must be at least 24 characters (the same text as LINKED_SENDER_SECRET on the website).");
if (!/^https:\/\//.test(appUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(appUrl)) throw new Error("APP_URL must be the website's https address.");

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const service = new SenderService({
  secret,
  appUrl,
  transport: new BaileysTransport({ authDir: process.env.AUTH_DIR ?? "./auth", log }),
  log,
});

await service.start(port);
log(`sender listening on ${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal}: stopping`);
    void service.stop().finally(() => process.exit(0));
  });
}
