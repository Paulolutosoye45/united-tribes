import qrcode from "qrcode-terminal";
import { BaileysTransport } from "./baileys.js";

/**
 * Links a WhatsApp number to the sender, once. Run it on the server (or anywhere you can keep the AUTH_DIR folder),
 * scan the code with the phone that has the number: WhatsApp > Settings > Linked devices > Link a device.
 */
const log = (line: string) => console.log(line);
const transport = new BaileysTransport({
  authDir: process.env.AUTH_DIR ?? "./auth",
  onQr: (qr) => {
    console.log("\nScan this with WhatsApp on the phone that has the number (Settings > Linked devices > Link a device):\n");
    qrcode.generate(qr, { small: true });
  },
  log,
});

await transport.start({
  onState: (state) => {
    log(`state: ${state}`);
    if (state === "open") {
      log("Linked. The login is saved. You can stop this (Ctrl+C) and run: npm start");
      setTimeout(() => process.exit(0), 3000);
    }
    if (state === "logged_out" || state === "restricted") {
      log("WhatsApp would not accept the link. Check the phone, then try again.");
      process.exit(1);
    }
  },
  onMessage: () => {},
  onReceipt: () => {},
});
