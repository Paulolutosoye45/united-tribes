import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Crest } from "@/components/brand/Crest";
import { Demos } from "@/components/design/Demos";
import { SAMPLE_MATCHES } from "@/components/design/sample-matches";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { MatchCard } from "@/components/ui/MatchCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = { title: "Style guide", robots: { index: false, follow: false } };

const SWATCHES = [
  { name: "Charcoal", token: "--crest-charcoal", hex: "#2E2E2B", use: "Headers, hero, strong surfaces", light: false },
  { name: "Flame", token: "--crest-flame", hex: "#E86838", use: "Main actions", light: false },
  { name: "Gold", token: "--crest-gold", hex: "#F4C443", use: "Highlights, selected, roles", light: true },
  { name: "Amber", token: "--crest-amber", hex: "#E89838", use: "Warm secondary accents", light: true },
];

/** Open in development. In production only when ENABLE_STYLE_PAGE=true. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_STYLE_PAGE !== "true") notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-4">
        <Crest size={72} animate title="United Tribes" />
        <h1 className="t-display">Style guide</h1>
        <p className="t-body measure text-soft">
          Colours from the Covenant Nation crest, one typeface, and a quartered shield that carries the match score. All
          people and tribes on this page are invented.
        </p>
      </header>

      <section className="flex flex-col gap-5" aria-labelledby="colour">
        <h2 id="colour" className="t-heading">Colour</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SWATCHES.map((s) => (
            <li key={s.token} className="overflow-hidden rounded-[var(--radius-control)] border border-line">
              <div
                className={`h-24 p-3 text-sm font-semibold ${s.light ? "text-on-flame" : s.name === "Charcoal" ? "text-white" : "text-on-flame"}`}
                style={{ background: `var(${s.token})` }}
              >
                {s.name}
              </div>
              <div className="p-3">
                <p className="t-small font-semibold tabular-nums">{s.hex}</p>
                <p className="t-small text-soft">{s.use}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="type">
        <h2 id="type" className="t-heading">Type</h2>
        <p className="t-display">Find your people.</p>
        <p className="t-title">Strong tribes start with a shared goal</p>
        <p className="t-heading">Your three best-fitting tribes</p>
        <p className="t-body measure">
          Everyone in a tribe is working toward the same goal for twelve weeks, so the conversation always has somewhere
          to go.
        </p>
        <p className="t-small text-soft">Supporting detail sits here, at 14 pixels.</p>
        <p className="t-figure">91%</p>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="match">
        <h2 id="match" className="t-heading">Match cards</h2>
        <p className="t-small measure text-soft">
          Each card has its own score, out of 100, and the four quarters of the shield show where it comes from: goal,
          season of life, place and rhythm, and style and faith.
        </p>
        <div className="grid gap-5 lg:grid-cols-3">
          {SAMPLE_MATCHES.map((m, i) => (
            <MatchCard key={m.tribeName} data={m} rank={i + 1} onChoose={undefined} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="parts">
        <h2 id="parts" className="t-heading">Small parts</h2>
        <div className="flex flex-wrap items-center gap-6">
          <Avatar name="Ada Obi" size={48} />
          <Badge>Member</Badge>
          <Badge tone="gold">Tribe leader</Badge>
          <Badge tone="flame">New</Badge>
          <Badge tone="charcoal">Admin</Badge>
          <ProgressRing value={0.67} label="Form progress" />
          <Spinner />
        </div>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="controls">
        <h2 id="controls" className="t-heading">Controls</h2>
        <Demos />
      </section>
    </main>
  );
}
