import { Badge } from "@/components/ui/Badge";
import type { WeekLayer } from "@/lib/rhythm/types";

/**
 * What sits on top of the weekly guide: the confession to say through the week, the sermon this week
 * is tied to, and, for a tribe, a skill-share prompt for its community and an idea for its Season Goal.
 */
export function ConfessionCard({ layer }: { layer: WeekLayer | null }) {
  if (!layer?.confession && !layer?.sermon_title) return null;
  return (
    <section aria-labelledby="confession-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      {layer.confession ? (
        <div className="flex flex-col gap-2">
          <h2 id="confession-heading" className="t-heading">
            Say this through the week
          </h2>
          <blockquote className="t-body measure border-l-4 border-gold pl-4 font-medium leading-relaxed">{layer.confession}</blockquote>
        </div>
      ) : null}
      {layer.sermon_title ? (
        <div className="flex flex-col gap-1 border-t border-line pt-4 first:border-0 first:pt-0">
          <h3 className="font-semibold">Linked to Sunday</h3>
          <p className="t-body text-soft">
            {layer.sermon_series ? <Badge tone="outline" className="mr-2">{layer.sermon_series}</Badge> : null}
            {layer.sermon_title}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** For the meeting: the community's skill-share prompt and a step idea for the tribe's Season Goal. */
export function CommunityLayerCard({ layer }: { layer: WeekLayer | null }) {
  if (!layer?.skill_share && !layer?.goal_idea) return null;
  return (
    <section aria-labelledby="community-layer-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="community-layer-heading" className="t-heading">
          For this tribe
        </h2>
        {layer.community ? <Badge tone="outline">{layer.community}</Badge> : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {layer.skill_share ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="font-semibold">Skill share</h3>
            <p className="t-body text-soft">{layer.skill_share}</p>
          </div>
        ) : null}
        {layer.goal_idea ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="font-semibold">An idea for {layer.goal ? `“${layer.goal}”` : "your goal"}</h3>
            <p className="t-body text-soft">{layer.goal_idea}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
