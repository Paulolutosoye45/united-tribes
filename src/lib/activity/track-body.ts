import { z } from "zod";
import { DEVICES, METHODS, SCREENS, SPEEDS } from "./screens";

/**
 * What a screen may tell the activity log: a kind, one of the named screens, a device class, a sign-in method, a speed band.
 * Nothing typed by a person can be in it: every field is picked from a fixed list. The database checks the same lists again.
 */
export const trackBody = z
  .object({
    kind: z.enum(["visit", "screen", "signin"]),
    screen: z.enum(SCREENS).optional(),
    device: z.enum(DEVICES).optional(),
    method: z.enum(METHODS).optional(),
    speed: z.enum(SPEEDS).optional(),
  })
  .strict()
  .refine((b) => b.kind !== "screen" || b.screen !== undefined, "A screen event names its screen")
  .refine((b) => b.kind === "screen" || b.screen === undefined, "Only a screen event has a screen")
  .refine((b) => b.kind === "signin" || b.method === undefined, "Only a sign-in has a method")
  .refine((b) => b.kind === "screen" || b.speed === undefined, "Only a screen has a speed");

export type TrackBody = z.infer<typeof trackBody>;

/** The biggest body the door reads. A real one is well under a hundred bytes. */
export const TRACK_MAX_BYTES = 400;

/** Parses the text of a request. Returns null for anything that is not exactly one allowed event. */
export function parseTrack(text: string): TrackBody | null {
  if (text.length === 0 || text.length > TRACK_MAX_BYTES) return null;
  try {
    const parsed = trackBody.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
