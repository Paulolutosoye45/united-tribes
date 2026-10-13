import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/system/ServiceWorker";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "United Tribes", template: "%s · United Tribes" },
  description: "Find your people. Grow together. Small tribes at The Covenant Nation, built around your season of life.",
  applicationName: "United Tribes",
  appleWebApp: { capable: true, title: "United Tribes", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is made fresh for each request. The security policy gives each request its own secret, which the pages
  // can only carry if they are not prepared in advance (see src/proxy.ts).
  await connection();
  return (
    <html lang="en-NG">
      <body>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
