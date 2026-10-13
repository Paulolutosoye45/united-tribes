import type { MetadataRoute } from "next";

/**
 * What a phone needs to offer "Add to Home Screen" and open the app like an app: its name, its colours and its icons.
 * Starting at /home sends someone who is not signed in to the sign-in page and straight back.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "United Tribes",
    short_name: "United Tribes",
    description: "Find your people. Grow together. Small tribes at The Covenant Nation, built around your season of life.",
    id: "/",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f4f1",
    theme_color: "#ffffff",
    lang: "en-NG",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
