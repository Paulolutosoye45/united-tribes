import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/(app)/actions";
import { requireSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "This page is for leaders" };

type Search = Promise<{ for?: string; from?: string }>;

/**
 * Where a person lands who opens a page their account is not allowed to. Instead of being sent home without a word, they are told who they are
 * signed in as, why the page is not theirs, how to switch account, and who to tell if they were appointed. Nothing here depends on the database
 * beyond who is signed in, so it works whatever the state of the season.
 */
export default async function NoAccessPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const session = await requireSession("/home");
  const from = safeNext(q.from, "/home");
  const forLeaders = q.for === "leader";
  const name = session.person.fullName ?? session.person.email;
  const roles = session.roles.map((r) => ROLE_LABELS[r] ?? r);

  return (
    <div className="flex flex-col gap-6" data-testid="no-access">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{forLeaders ? "This page is for tribe leaders." : "This page is not open to your account."}</h1>
        <p className="t-body measure text-soft" data-testid="no-access-who">
          You are signed in as {name} ({session.person.email}). {roles.length > 0 ? `Roles on this account: ${roles.join(", ")}.` : ""}
          {forLeaders ? " It does not have the leader role, so the page you asked for is not shown." : ""}
        </p>
      </header>

      {forLeaders ? (
        <section aria-labelledby="appointed" className="card flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="appointed" className="t-heading">
            If you were appointed as a leader
          </h2>
          <ul className="t-body flex list-disc flex-col gap-2 pl-5">
            <li>You may have signed in with a different email address or phone number from the one the church used to appoint you. Sign out, then sign in with the one you were appointed with.</li>
            <li>If you are sure it is the right one, tell the church office, or the person who appointed you. The appointment may not have been completed, and they can check it.</li>
            <li>You do not need to do anything else: once your account has the leader role, this page opens by itself.</li>
          </ul>
          <form action={signOut}>
            <button type="submit" className="btn btn-solid inline-flex h-12 items-center rounded-[var(--radius-control)] px-5 font-semibold" data-testid="no-access-switch">
              Sign out and use another account
            </button>
          </form>
        </section>
      ) : (
        <section className="card flex flex-col gap-3 p-5 sm:p-6">
          <p className="t-body">If you think you should be able to open it, sign in with the account you were given the role on, or tell the church office.</p>
          <form action={signOut}>
            <button type="submit" className="btn inline-flex h-12 items-center rounded-[var(--radius-control)] px-5 font-semibold" data-testid="no-access-switch">
              Sign out and use another account
            </button>
          </form>
        </section>
      )}

      <p className="t-small text-soft">
        You were trying to open <span className="font-mono">{from}</span>.{" "}
        <Link href="/home" className="font-semibold underline underline-offset-4" data-testid="no-access-home">
          Go to my home
        </Link>
      </p>
    </div>
  );
}
