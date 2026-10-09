import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "United Tribes", template: "%s · United Tribes" },
  description: "Find your people. Grow together. Small Tribes at The Covenant Nation, built around your season of life.",
  applicationName: "United Tribes",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
