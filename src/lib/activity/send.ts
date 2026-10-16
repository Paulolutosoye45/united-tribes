import type { TrackBody } from "./track-body";

/**
 * Tells the activity log about one thing, from the browser. It never waits, never shows an error and never throws: a missed
 * event is simply a missed event. It survives the page closing or changing (a beacon, else a keep-alive request).
 */
export function sendTrack(body: TrackBody): void {
  try {
    const json = JSON.stringify(body);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/track", new Blob([json], { type: "application/json" }))) return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Nothing to do: tracking is never allowed to get in the way.
  }
}
