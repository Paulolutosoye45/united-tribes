import type { NextConfig } from "next";

/**
 * Phase 0 keeps rendering simple: every signed-in screen is personal to the
 * member, so pages render per request. Cache Components (the scaffold default)
 * can be adopted later for public pages; see the note in README.md.
 */
const nextConfig: NextConfig = {
  // A self-contained server for the Dockerfile (BUILD_STANDALONE=1 is set there). Everywhere else the normal build is used.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  /**
   * LINKS SENT BEFORE THE NEW NAMES. A "circle" became a "tribe" and a "tribe" became a "community" (see
   * UPGRADE-TRIBES.md). Messages, emails and installed home-screen shortcuts that were sent with the old addresses must keep
   * working, so each old address goes to its new home. Temporary redirects (307), so nothing is cached for ever.
   * This is the one place in the app that still says "circle" on purpose.
   */
  async redirects() {
    const id = "(?<id>[0-9a-fA-F-]{36})";
    // Next.js hands the old query on to the new address as well, so a rule that adds the new key must not fire again once the
    // new key is there (`missing`), or the address would redirect to itself for ever.
    const noNew = (key: string) => [{ type: "query" as const, key }];
    return [
      { source: "/circle", destination: "/tribe", permanent: false },
      { source: "/circle/:path*", destination: "/tribe/:path*", permanent: false },
      { source: "/lead/circle", destination: "/lead/tribe", permanent: false },
      { source: "/lead/circle/:path*", destination: "/lead/tribe/:path*", permanent: false },
      { source: "/god/circles", destination: "/god/tribes", permanent: false },
      { source: "/god/circles/:path*", destination: "/god/tribes/:path*", permanent: false },
      // A leader's or coach's link to one group's week or progress carried ?circle=<id>; it is now ?tribe=<id>.
      { source: "/lead/week", has: [{ type: "query" as const, key: "circle", value: id }], missing: noNew("tribe"), destination: "/lead/week?tribe=:id", permanent: false },
      { source: "/lead/progress", has: [{ type: "query" as const, key: "circle", value: id }], missing: noNew("tribe"), destination: "/lead/progress?tribe=:id", permanent: false },
      // A champion's link to one interest area (/tribe?tribe=<id>) is now /community?community=<id>; the same for testimony filters.
      { source: "/tribe", has: [{ type: "query" as const, key: "tribe", value: id }], destination: "/community?community=:id", permanent: false },
      { source: "/testimonies", has: [{ type: "query" as const, key: "tribe", value: id }], missing: noNew("community"), destination: "/testimonies?community=:id", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh, or a bad version could never be replaced.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
