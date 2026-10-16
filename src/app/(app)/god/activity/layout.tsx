import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ActivityTabs } from "@/components/activity/ActivityTabs";

export const metadata: Metadata = { title: "Activity", robots: { index: false, follow: false } };

/**
 * The activity dashboard, inside the owner's console. The console layout above already turns away anyone who is not the
 * owner (a page that does not exist) and holds the owner at the unlock step; every report below asks the database again.
 */
export default function ActivityLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="t-title">Activity and decisions</h1>
        <p className="t-body measure text-soft">
          Who is using the platform, where they stop, and what needs a decision. It records which screens are used and when, never what anyone writes. Only you can see this.
        </p>
        <ActivityTabs />
      </header>
      {children}
    </div>
  );
}
