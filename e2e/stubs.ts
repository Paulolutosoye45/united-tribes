/**
 * Stand-ins for the message providers (Meta's WhatsApp API, Resend, Termii), so the
 * real sending code can be exercised over real HTTP without any account. They check
 * the credentials the app sends, record what arrived, and answer the way the real
 * services do, including a failure for a WhatsApp number ending 0000 ("not on WhatsApp").
 *
 *   GET  /__sent[?channel=whatsapp|email|sms]   what has been received, oldest first
 *   POST /__reset                               forget everything
 *
 * It also stands in for Cloudflare Turnstile (the bot check):
 *
 *   GET  /turnstile/api.js                      a widget that hands the page a token straight away
 *   POST /turnstile/siteverify                  checks the secret and the token, and spends the token (each works once)
 *   GET  /__turnstile                           every check made, oldest first
 *   POST /__turnstile/mode  {"refuse": true}    make every check fail, to prove the app fails closed
 */
import http from "node:http";

export type Received = { channel: "whatsapp" | "email" | "sms"; at: number; id: string; body: Record<string, unknown> };

export const KEYS = { whatsappToken: "wa_e2e_token", phoneNumberId: "100200300", resend: "re_e2e", termii: "tm_e2e" } as const;

export const TURNSTILE = { siteKey: "1x00000000000000000000AA", secret: "e2e-turnstile-secret", tokenPrefix: "e2e-turnstile-token-" } as const;

/** What the browser runs in place of Cloudflare's script: the same four calls, and a fresh token whenever one is asked for. */
const TURNSTILE_SCRIPT = `(function () {
  var n = 0;
  var widgets = {};
  function issue(id) {
    var w = widgets[id];
    if (w) setTimeout(function () { w.callback("${TURNSTILE.tokenPrefix}" + id + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)); }, 20);
  }
  window.turnstile = {
    render: function (el, options) {
      var id = "w" + (++n);
      widgets[id] = options;
      el.setAttribute("data-widget", id);
      issue(id);
      return id;
    },
    reset: function (id) { issue(id); },
    remove: function (id) { delete widgets[id]; },
  };
})();
`;

export type Verified = { at: number; token: string; ok: boolean; reason?: string };

export function startStubs(port: number): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const verified: Verified[] = [];
  const spent = new Set<string>();
  let refuseAll = false;
  let counter = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = { raw };
      }
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const url = new URL(req.url ?? "/", "http://stub");

      if (req.method === "GET" && url.pathname === "/__sent") {
        const channel = url.searchParams.get("channel");
        return send(200, received.filter((r) => !channel || r.channel === channel));
      }
      if (req.method === "POST" && url.pathname === "/__reset") {
        received.length = 0;
        return send(200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/turnstile/api.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
        return void res.end(TURNSTILE_SCRIPT);
      }
      if (req.method === "GET" && url.pathname === "/__turnstile") return send(200, verified);
      if (req.method === "POST" && url.pathname === "/__turnstile/mode") {
        refuseAll = body.refuse === true;
        return send(200, { refuse: refuseAll });
      }
      if (req.method === "POST" && url.pathname === "/turnstile/siteverify") {
        const form = new URLSearchParams(typeof body.raw === "string" ? body.raw : "");
        const token = form.get("response") ?? "";
        const record = (ok: boolean, reason?: string) => {
          verified.push({ at: Date.now(), token, ok, reason });
          return ok ? send(200, { success: true }) : send(200, { success: false, "error-codes": [reason ?? "invalid-input-response"] });
        };
        if (form.get("secret") !== TURNSTILE.secret) return record(false, "invalid-input-secret");
        if (refuseAll) return record(false, "refused-by-test");
        if (!token.startsWith(TURNSTILE.tokenPrefix)) return record(false, "invalid-input-response");
        if (spent.has(token)) return record(false, "timeout-or-duplicate");
        spent.add(token);
        return record(true);
      }

      // Meta Cloud API: POST /v23.0/<phone number id>/messages
      const wa = /^\/v[\d.]+\/(\d+)\/messages$/.exec(url.pathname);
      if (req.method === "POST" && wa) {
        if (req.headers.authorization !== `Bearer ${KEYS.whatsappToken}` || wa[1] !== KEYS.phoneNumberId) {
          return send(401, { error: { code: 190, message: "Invalid OAuth access token" } });
        }
        const to = String(body.to ?? "");
        const template = body.template as { name?: string } | undefined;
        if (body.messaging_product !== "whatsapp" || body.type !== "template" || !template?.name?.startsWith("ut_")) {
          return send(400, { error: { code: 100, message: "Invalid parameter" } });
        }
        if (to.endsWith("0000")) return send(400, { error: { code: 131026, message: "Message undeliverable" } });
        const id = `wamid.E2E${++counter}`;
        received.push({ channel: "whatsapp", at: Date.now(), id, body });
        return send(200, { messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id }] });
      }

      // Resend: POST /emails
      if (req.method === "POST" && url.pathname === "/emails") {
        if (req.headers.authorization !== `Bearer ${KEYS.resend}`) return send(401, { message: "API key is invalid" });
        if (!Array.isArray(body.to) || typeof body.subject !== "string" || typeof body.html !== "string" || typeof body.text !== "string") {
          return send(422, { message: "Missing required fields" });
        }
        const id = `em_e2e_${++counter}`;
        received.push({ channel: "email", at: Date.now(), id, body });
        return send(200, { id });
      }

      // Termii: POST /api/sms/send
      if (req.method === "POST" && url.pathname === "/api/sms/send") {
        if (body.api_key !== KEYS.termii) return send(401, { message: "Invalid API key" });
        const id = `tm_e2e_${++counter}`;
        received.push({ channel: "sms", at: Date.now(), id, body: { ...body, api_key: "***" } });
        return send(200, { code: "ok", message_id: id, message: "Successfully Sent", balance: 100, user: "e2e" });
      }

      send(404, { error: "not found" });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}
