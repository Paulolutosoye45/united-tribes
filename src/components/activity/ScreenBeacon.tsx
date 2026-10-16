"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { deviceOf, screenOf, speedOf } from "@/lib/activity/screens";
import { sendTrack } from "@/lib/activity/send";

// Only the first screen of a visit (a full page load) can say how long it took; screens reached by tapping inside the app
// are counted without a speed. The same screen again within 20 seconds is counted once, by the database.
let firstLoad = true;

function loadMs(): number | null {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null;
  } catch {
    return null;
  }
}

/**
 * Tells the activity log which named screen is open, from which kind of device, and for a full page load a coarse speed band.
 * It draws nothing, reads nothing a person typed, and sends only the screen's name: never the address, a query or an id.
 * It is not mounted on the owner's console, and the database ignores the owner and any hidden account in any case.
 */
export function ScreenBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    const screen = screenOf(pathname);
    if (!screen) return;
    const device = deviceOf(window.innerWidth);
    const send = (ms: number | null) => {
      const speed = speedOf(ms);
      sendTrack({ kind: "screen", screen, device, ...(speed ? { speed } : {}) });
    };
    if (!firstLoad) {
      send(null);
      return;
    }
    firstLoad = false;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      send(loadMs());
    };
    if (document.readyState === "complete") {
      const t = setTimeout(go, 0);
      return () => {
        clearTimeout(t);
        go();
      };
    }
    const onLoad = () => setTimeout(go, 0);
    window.addEventListener("load", onLoad, { once: true });
    return () => {
      window.removeEventListener("load", onLoad);
      go();
    };
  }, [pathname]);
  return null;
}
