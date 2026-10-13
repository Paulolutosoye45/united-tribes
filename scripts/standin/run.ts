/**
 * Runs the app’s backend on your own machine with no Supabase project:
 *
 *   npm run standin
 *
 * then, in a second terminal, copy the two lines it prints into .env.local and
 * run `npm run dev`. Sign in with any email and the code 123456.
 * Emails that start pastor., director., coach., care_lead., data_lead.,
 * community_champion. or admin. get that role (for example pastor.ife@example.org).
 *
 * For local work only. See server.ts.
 */
import { bootStandin } from "./boot";

async function main() {
  const booted = await bootStandin();
  console.log("\nThe stand-in is running. It is for local work only.\n");
  console.log("Put these in .env.local:\n");
  console.log(`NEXT_PUBLIC_SUPABASE_URL=${booted.apiUrl}`);
  console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${booted.anonKey}\n`);
  console.log("Sign in with any email address and the code 123456. Press Ctrl+C to stop; everything is erased when it stops.\n");
  const stop = async () => {
    await booted.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

void main();
