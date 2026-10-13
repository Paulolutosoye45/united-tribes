"use client";

import Link from "next/link";
import { useState } from "react";
import {
  adoptWriteInAction,
  dismissWriteInAction,
  saveFamilyAction,
  saveGoalAction,
  saveCommunityAction,
  setGoalActiveAction,
  setTrackActiveAction,
} from "@/app/(app)/admin/catalogue/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { plural } from "@/lib/dates";
import type { AdminCatalogue, CatalogueFamily, CatalogueGoal, CatalogueCommunity, WriteIn } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

export function CatalogueBoard({ catalogue, writeIns, showSingles }: { catalogue: AdminCatalogue; writeIns: WriteIn[]; showSingles: boolean }) {
  const { can_edit: canEdit } = catalogue;
  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="communities-heading" className="flex flex-col gap-4">
        <h2 id="communities-heading" className="t-heading">
          Communities and Season Goals
        </h2>
        <p className="t-body measure text-soft">
          Members and leaders choose from the same list, so the matching can pair them exactly. A retired goal can no longer be chosen; people who chose it before keep it.
        </p>
        <ul className="flex flex-col gap-5">
          {catalogue.communities.map((t) => (
            <li key={t.id}>
              <CommunityCard community={t} families={catalogue.families} communities={catalogue.communities} canEdit={canEdit} />
            </li>
          ))}
        </ul>
        {canEdit ? <CommunityForm community={null} onDone={() => undefined} /> : null}
      </section>

      <WriteIns writeIns={writeIns} catalogue={catalogue} canEdit={canEdit} showSingles={showSingles} />

      <section aria-labelledby="families-heading" className="flex flex-col gap-4">
        <h2 id="families-heading" className="t-heading">
          Goal families
        </h2>
        <p className="t-body measure text-soft">A family groups goals that are close to each other. When no tribe fits a member&rsquo;s goal exactly, the matching looks in the same family.</p>
        <Families families={catalogue.families} canEdit={canEdit} />
      </section>

      <Tracks catalogue={catalogue} canEdit={canEdit} />
    </div>
  );
}

function CommunityCard({ community, families, communities, canEdit }: { community: CatalogueCommunity; families: CatalogueFamily[]; communities: CatalogueCommunity[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const d = useDo();
  const open = community.goals.filter((g) => g.active);
  const retired = community.goals.filter((g) => !g.active);

  return (
    <article className={`card flex flex-col gap-4 p-5 sm:p-6 ${community.active ? "" : "opacity-80"}`} aria-label={community.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-heading">{community.name}</h3>
            {community.active ? null : <Badge tone="outline">Closed</Badge>}
          </div>
          {community.description ? <p className="t-body text-soft">{community.description}</p> : null}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {editing ? "Close" : "Edit community"}
            </Button>
            <Button size="sm" variant="quiet" loading={d.busy === "toggle"} disabled={d.busy !== null} onClick={() => void d.go("toggle", () => saveCommunityAction(community.id, community.name, community.description, !community.active))}>
              {community.active ? "Close community" : "Reopen community"}
            </Button>
          </div>
        ) : null}
      </div>
      <Notice error={d.error} />
      {editing ? <CommunityForm community={community} onDone={() => setEditing(false)} /> : null}

      {open.length === 0 ? <p className="t-body text-soft">No goal is open for this community.</p> : null}
      {open.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {open.map((g) => (
            <GoalRow key={g.id} goal={g} community={community} communities={communities} families={families} canEdit={canEdit} />
          ))}
        </ul>
      ) : null}

      {retired.length > 0 ? (
        <details>
          <summary className="t-small cursor-pointer text-soft">{plural(retired.length, "retired goal")}</summary>
          <ul className="mt-2 flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {retired.map((g) => (
              <GoalRow key={g.id} goal={g} community={community} communities={communities} families={families} canEdit={canEdit} />
            ))}
          </ul>
        </details>
      ) : null}

      {canEdit && community.active ? (
        adding ? (
          <GoalForm goal={null} community={community} communities={communities} families={families} onDone={() => setAdding(false)} />
        ) : (
          <div>
            <Button size="sm" variant="quiet" onClick={() => setAdding(true)}>
              Add a goal to {community.name}
            </Button>
          </div>
        )
      ) : null}
    </article>
  );
}

function GoalRow({ goal, community, communities, families, canEdit }: { goal: CatalogueGoal; community: CatalogueCommunity; communities: CatalogueCommunity[]; families: CatalogueFamily[]; canEdit: boolean }) {
  const d = useDo();
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className={`font-medium ${goal.active ? "" : "text-soft line-through"}`}>{goal.title}</span>
          <span className="t-small text-soft">
            {goal.family} · {goal.picked} chose it this season · {goal.ever} ever · {plural(goal.tribes, "tribe")}
          </span>
        </span>
        {canEdit ? (
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {editing ? "Close" : "Edit"}
            </Button>
            <Button size="sm" variant="quiet" loading={d.busy === "toggle"} disabled={d.busy !== null} onClick={() => void d.go("toggle", () => setGoalActiveAction(goal.id, !goal.active))}>
              {goal.active ? "Retire" : "Restore"}
            </Button>
          </span>
        ) : null}
      </div>
      <Notice error={d.error} />
      {editing ? <GoalForm goal={goal} community={community} communities={communities} families={families} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

function GoalForm({ goal, community, communities, families, onDone }: { goal: CatalogueGoal | null; community: CatalogueCommunity; communities: CatalogueCommunity[]; families: CatalogueFamily[]; onDone: () => void }) {
  const d = useDo();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [family, setFamily] = useState(goal?.family_id ?? families[0]?.id ?? "");
  const [communityId, setCommunityId] = useState(community.id);

  async function save() {
    const ok = await d.go("save", () => saveGoalAction(goal?.id ?? null, communityId, family, title), { saved: goal ? "Saved." : "Goal added.", after: goal ? onDone : undefined });
    if (ok && !goal) setTitle("");
  }

  return (
    <form
      noValidate
      aria-label={goal ? `Edit ${goal.title}` : `Add a goal to ${community.name}`}
      className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input label="The goal, as a member would say it" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Step into a leadership role" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Family" value={family} onChange={(e) => setFamily(e.target.value)}>
          {families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {goal ? (
          <Select label="Community" value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
            {communities.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <Notice error={d.error} saved={d.saved} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={d.busy === "save"} disabled={title.trim().length < 6 || !family}>
          {goal ? "Save" : "Add the goal"}
        </Button>
        {goal ? null : (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function CommunityForm({ community, onDone }: { community: CatalogueCommunity | null; onDone: () => void }) {
  const d = useDo();
  const [name, setName] = useState(community?.name ?? "");
  const [description, setDescription] = useState(community?.description ?? "");

  async function save() {
    const ok = await d.go("save", () => saveCommunityAction(community?.id ?? null, name, description, community?.active ?? true), {
      saved: community ? "Saved." : "Community added.",
      after: community ? onDone : undefined,
    });
    if (ok && !community) {
      setName("");
      setDescription("");
    }
  }

  return (
    <form
      noValidate
      aria-label={community ? `Edit ${community.name}` : "Add a community"}
      className={community ? "flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4" : "card flex flex-col gap-4 p-5"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {community ? null : <h3 className="t-heading">Add a community</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Input label="In a sentence" optional value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </div>
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="sm" loading={d.busy === "save"} disabled={name.trim().length < 3}>
          {community ? "Save" : "Add the community"}
        </Button>
      </div>
    </form>
  );
}

function WriteIns({ writeIns, catalogue, canEdit, showSingles }: { writeIns: WriteIn[]; catalogue: AdminCatalogue; canEdit: boolean; showSingles: boolean }) {
  return (
    <section aria-labelledby="writeins-heading" className="flex flex-col gap-4">
      <h2 id="writeins-heading" className="t-heading">
        Goals members wrote in
      </h2>
      <p className="t-body measure text-soft">
        When no goal fits, a member can write their own. Wording that two or more members wrote is listed here, so one person&rsquo;s sentence is never singled out. Add the good ones to the
        catalogue; the team approves every new goal.
      </p>
      {writeIns.length === 0 ? (
        <p className="card t-body p-5 text-soft">{showSingles ? "No member has written in a goal." : "Nothing is waiting. No wording has been written in by two or more members."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {writeIns.map((w) => (
            <li key={`${w.community_id}:${w.text}`}>
              <WriteInRow item={w} catalogue={catalogue} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
      <p className="t-small text-soft">
        {showSingles ? (
          <>
            Showing wording written by one member as well. <Link href="/admin/catalogue" className="underline">Hide those</Link>
          </>
        ) : (
          <>
            <Link href="/admin/catalogue?singles=1" className="underline">
              Show wording written by only one member
            </Link>
            . A single sentence can identify someone, so use that with care.
          </>
        )}
      </p>
    </section>
  );
}

function WriteInRow({ item, catalogue, canEdit }: { item: WriteIn; catalogue: AdminCatalogue; canEdit: boolean }) {
  const d = useDo();
  const [adding, setAdding] = useState(false);
  const active = catalogue.communities.filter((t) => t.active);
  const [community, setCommunity] = useState(item.community_id && active.some((t) => t.id === item.community_id) ? item.community_id : (active[0]?.id ?? ""));
  const [family, setFamily] = useState(catalogue.families[0]?.id ?? "");
  const [title, setTitle] = useState(item.text.charAt(0).toUpperCase() + item.text.slice(1));

  return (
    <article className="card flex flex-col gap-3 p-4" aria-label={item.text}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">&ldquo;{item.text}&rdquo;</span>
          <span className="t-small text-soft">
            {plural(item.count, "member")}
            {item.community ? ` · ${item.community}` : ""}
          </span>
        </span>
        {canEdit ? (
          <span className="flex gap-2">
            <Button size="sm" variant="solid" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              Add to the catalogue
            </Button>
            <Button size="sm" variant="quiet" loading={d.busy === "dismiss"} disabled={d.busy !== null} onClick={() => void d.go("dismiss", () => dismissWriteInAction(item.text))}>
              Not for the catalogue
            </Button>
          </span>
        ) : null}
      </div>
      <Notice error={d.error} />
      {adding ? (
        <form
          noValidate
          aria-label={`Add “${item.text}” to the catalogue`}
          className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("adopt", () => adoptWriteInAction(item.text, community, family, title), { after: () => setAdding(false) });
          }}
        >
          <Input label="The goal, as it should read in the catalogue" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Community" value={community} onChange={(e) => setCommunity(e.target.value)}>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select label="Family" value={family} onChange={(e) => setFamily(e.target.value)}>
              {catalogue.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Button type="submit" size="sm" loading={d.busy === "adopt"} disabled={title.trim().length < 6 || !community || !family}>
              Add the goal
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function Families({ families, canEdit }: { families: CatalogueFamily[]; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="card flex flex-col divide-y divide-line p-0">
        {families.map((f) => (
          <FamilyRow key={f.id} family={f} canEdit={canEdit} />
        ))}
      </ul>
      {canEdit ? <FamilyForm /> : null}
    </div>
  );
}

function FamilyRow({ family, canEdit }: { family: CatalogueFamily; canEdit: boolean }) {
  const d = useDo();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(family.name);
  return (
    <li className="flex flex-col gap-3 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-medium">{family.name}</span>
          <span className="t-small text-soft">{plural(family.goals, "goal")}</span>
        </span>
        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? "Close" : "Rename"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          noValidate
          aria-label={`Rename ${family.name}`}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("save", () => saveFamilyAction(family.id, name), { after: () => setEditing(false) });
          }}
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Notice error={d.error} />
          <div>
            <Button type="submit" size="sm" loading={d.busy === "save"} disabled={name.trim().length < 3}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function FamilyForm() {
  const d = useDo();
  const [name, setName] = useState("");
  return (
    <form
      noValidate
      aria-label="Add a goal family"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("save", () => saveFamilyAction(null, name), { saved: "Family added.", after: () => setName("") });
      }}
    >
      <Input label="Add a family" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="sm" variant="quiet" loading={d.busy === "save"} disabled={name.trim().length < 3}>
          Add the family
        </Button>
      </div>
    </form>
  );
}

function Tracks({ catalogue, canEdit }: { catalogue: AdminCatalogue; canEdit: boolean }) {
  return (
    <section aria-labelledby="tracks-heading" className="flex flex-col gap-4">
      <h2 id="tracks-heading" className="t-heading">
        Age tracks
      </h2>
      <p className="t-body measure text-soft">Members are placed with people in the same season of life. A track that is closed cannot be chosen by new members.</p>
      <ul className="card flex flex-col divide-y divide-line p-0">
        {catalogue.tracks.map((k) => (
          <TrackRow key={k.id} track={k} canEdit={canEdit} teensAllowed={catalogue.teens_allowed} />
        ))}
      </ul>
    </section>
  );
}

function TrackRow({ track, canEdit, teensAllowed }: { track: AdminCatalogue["tracks"][number]; canEdit: boolean; teensAllowed: boolean }) {
  const d = useDo();
  const blocked = track.slug === "teens" && !track.active && !teensAllowed;
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{track.name}</span>
            <Badge tone={track.active ? "gold" : "outline"}>{track.active ? "Open" : "Closed"}</Badge>
          </span>
          <span className="t-small text-soft">
            {track.ranges.length > 0 ? track.ranges.join(" · ") : `Ages ${track.min_age}${track.max_age ? ` to ${track.max_age}` : " and over"}`}
          </span>
        </span>
        {canEdit ? (
          <Button size="sm" variant="quiet" loading={d.busy === "toggle"} disabled={d.busy !== null || blocked} onClick={() => void d.go("toggle", () => setTrackActiveAction(track.id, !track.active))}>
            {track.active ? "Close" : "Open"}
          </Button>
        ) : null}
      </div>
      {blocked ? (
        <p className="t-small text-soft">
          The teen track also needs the platform switch, which only the database owner can turn on, after the safeguarding steps in docs/TEENS.md. Until then it stays closed.
        </p>
      ) : null}
      <Notice error={d.error} />
    </li>
  );
}
