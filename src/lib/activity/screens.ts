// The screens the activity log knows by name, and how a page address becomes one of them.
// The list must match the activity_screens table in supabase/migrations/20261215000100_activity.sql (a unit test checks).
// Anything not named here is never recorded: sign-in pages, public links, the owner's console.

export const SCREENS = [
  "home",
  "join",
  "tribe",
  "tribe_choose",
  "testimony",
  "testimonies",
  "profile",
  "community",
  "lead_apply",
  "lead_home",
  "lead_week",
  "lead_tribe",
  "lead_update",
  "lead_progress",
  "lead_academy",
  "review",
  "care",
  "dashboard",
  "reports",
  "growth",
  "admin",
  "admin_people",
  "admin_messages",
  "admin_signin",
] as const;
export type Screen = (typeof SCREENS)[number];

export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export const SPEEDS = ["fast", "ok", "slow"] as const;
export type Speed = (typeof SPEEDS)[number];

export const METHODS = ["email", "whatsapp", "google", "link"] as const;
export type Method = (typeof METHODS)[number];

const under = (path: string, head: string) => path === head || path.startsWith(`${head}/`);

/** The named screen for a page address, or null when the page is not one that is recorded. Only the path is ever looked at. */
export function screenOf(pathname: string | null | undefined): Screen | null {
  if (!pathname || !pathname.startsWith("/")) return null;
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";

  if (under(path, "/god")) return null;
  if (path === "/home") return "home";
  if (path === "/join") return "join";
  if (path === "/tribe") return "tribe";
  if (under(path, "/tribe/choose")) return "tribe_choose";
  if (path === "/tribe/testimony") return "testimony";
  if (path === "/testimonies") return "testimonies";
  if (path === "/profile") return "profile";
  if (path === "/community") return "community";

  if (path === "/lead/apply") return "lead_apply";
  if (path === "/lead") return "lead_home";
  if (path === "/lead/week") return "lead_week";
  if (path === "/lead/tribe") return "lead_tribe";
  if (path === "/lead/update") return "lead_update";
  if (path === "/lead/progress") return "lead_progress";
  if (under(path, "/lead/academy")) return "lead_academy";

  if (under(path, "/review")) return "review";
  if (under(path, "/care")) return "care";
  if (path === "/dashboard") return "dashboard";
  if (under(path, "/reports")) return "reports";
  if (under(path, "/growth")) return "growth";
  if (path === "/admin/people") return "admin_people";
  if (path === "/admin/messages") return "admin_messages";
  if (path === "/admin/signin") return "admin_signin";
  if (under(path, "/admin")) return "admin";
  return null;
}

/** Phone, tablet or desktop, from the width of the window. Nothing else about the device is looked at. */
export function deviceOf(width: number): Device {
  if (!Number.isFinite(width) || width <= 0) return "desktop";
  if (width < 640) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

/** A coarse band for how long a page took to load: under a second, up to three seconds, or longer. */
export function speedOf(ms: number | null | undefined): Speed | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return "fast";
  if (ms < 3000) return "ok";
  return "slow";
}
