import type { MeetingMode, MeetingTime, WorkStatus, Zone } from "./options";

export type TimeSuggestion = { id: MeetingTime; reason: string };

/**
 * Which meeting times to suggest first. No assistant is involved: it is a few plain rules about how people in
 * Lagos actually move around, so it works for everyone, offline, and can be explained in one line.
 *
 *   - Traffic: on the Mainland and across the bridges, a weekday evening meeting is hard to reach
 *     in person before about 8 pm, so Sunday afternoon and Saturday morning come first for in-person tribes.
 *   - Online tribes do not pay the traffic, so weeknights after 8 pm work for anyone with a job or lessons.
 *   - Students and people at home have free Saturday mornings; people with a job rarely do.
 *   - Abroad, Lagos evenings are the morning or afternoon at home for some, so Sunday evening (Lagos) leads.
 *
 *   - Young children: in person, a weeknight is out of reach, so the weekend leads; online, after bedtime works.
 *
 * At most three, with the reason in plain words. The member can tick anything else.
 */
export function suggestTimes(input: { zone?: Zone; mode?: MeetingMode; work?: WorkStatus; kids?: boolean }): TimeSuggestion[] {
  const { zone, mode, work, kids } = input;
  const out: TimeSuggestion[] = [];
  const add = (id: MeetingTime, reason: string) => {
    if (!out.some((s) => s.id === id)) out.push({ id, reason });
  };

  const online = mode === "online" || zone === "abroad";
  const working = work === "employed" || work === "self_employed" || work === "nysc";
  const freeMornings = work === "student" || work === "homemaker" || work === "retired" || work === "between_jobs";
  const crossTown = zone === "mainland" || zone === "island-lekki";

  if (zone === "abroad") {
    add("sunday-evening", "Sunday evening in Lagos is a good hour from most countries abroad");
    add("saturday-morning", "Saturday morning in Lagos is easy for many people abroad");
  } else if (online && working) {
    add("weeknight-evening", "After about 8 pm you can join from home without the traffic");
    add("sunday-evening", "Sunday evening is free for most people who work");
  } else if (!online && crossTown) {
    add("sunday-afternoon", "Right after service, before the week’s traffic");
    if (freeMornings) add("saturday-morning", "Saturday morning is quiet on the roads and free for you");
    else add("weeknight-evening", "Only if it starts after about 8 pm, when the roads clear");
  } else if (working) {
    add("weeknight-evening", "After about 8 pm, when work and traffic are done");
    add("sunday-afternoon", "Right after service");
  } else if (freeMornings) {
    add("saturday-morning", "A quiet morning, with the roads clear");
    add("sunday-afternoon", "Right after service");
  } else {
    add("sunday-afternoon", "Right after service, when most people are free");
    add("saturday-morning", "A quiet morning, with the roads clear");
  }

  // Always give at least two and never more than three.
  add("sunday-afternoon", "Right after service, when most people are free");
  add("saturday-morning", "A quiet morning, with the roads clear");

  if (kids) {
    if (online) {
      const night = out.find((s) => s.id === "weeknight-evening");
      if (night) night.reason = "After the children are in bed, from home";
    } else {
      const drop = out.findIndex((s) => s.id === "weeknight-evening");
      if (drop !== -1) out.splice(drop, 1);
      const first = out.find((s) => s.id === "sunday-afternoon");
      if (first) first.reason = "Right after service, with the children";
      add("saturday-morning", "A quiet morning for the whole family, with the roads clear");
    }
  }
  return out.slice(0, 3);
}
