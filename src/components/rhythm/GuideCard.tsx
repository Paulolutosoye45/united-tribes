import { SuccessPicture } from "@/components/matching/SuccessPicture";
import { Badge } from "@/components/ui/Badge";
import type { MemberGuide, Picture } from "@/lib/rhythm/types";
import { THEME_LABELS } from "@/lib/rhythm/wording";

/** The week's guide for a member: the idea, the passage, what to talk about and what to pray. */
export function GuideCard({ guide }: { guide: MemberGuide }) {
  return (
    <section aria-labelledby="guide-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{THEME_LABELS[guide.theme]}</Badge>
          <Badge tone="neutral">{guide.passage}</Badge>
        </div>
        <h2 id="guide-heading" className="t-heading">
          What this week is about
        </h2>
        <p className="t-body measure">{guide.big_idea}</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="font-semibold">Come ready to talk about</h3>
        <p className="t-body text-soft">{guide.opening_question}</p>
        <ul className="t-body flex list-disc flex-col gap-1.5 pl-5">
          {guide.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-semibold">This week’s practice</h3>
          <p className="t-body text-soft">{guide.practice}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Pray</h3>
          <p className="t-body text-soft">{guide.prayer}</p>
        </div>
      </div>
    </section>
  );
}

export function PictureCard({ picture }: { picture: Picture }) {
  return (
    <section aria-labelledby="picture-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="picture-heading" className="t-heading">
          Your Tribe’s Success Picture
        </h2>
        <Badge tone={picture.refined ? "gold" : "outline"}>{picture.refined ? "Settled in week 1" : "Draft, settled in week 1"}</Badge>
      </div>
      <SuccessPicture god={picture.god} others={picture.others} life={picture.life} />
    </section>
  );
}
