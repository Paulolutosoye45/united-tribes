import type { Zone } from "./options";

/**
 * Where people live, so "Yaba" or "Sangotedo" is enough and the Lagos zone follows by itself.
 * It runs in the browser with no network and no assistant, so it works on a poor connection and for
 * everyone. A place that is not here can still be typed in words, and the person picks the closest zone.
 *
 * The zones are the same five the matching engine uses (see ZONES in options.ts). Lagos is divided the way
 * most people at The Covenant Nation travel: Iganmu and its neighbours, the Mainland, and the Island with
 * the Lekki axis. Edit this list freely; the engine only ever sees the zone.
 */
export type Area = { name: string; slug: string; zone: Zone; aliases?: string[] };

type Row = [name: string, aliases?: string[]];

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

function build(zone: Zone, rows: Row[]): Area[] {
  return rows.map(([name, aliases]) => ({ name, slug: slugOf(name), zone, aliases }));
}

export const AREAS: Area[] = [
  ...build("iganmu-surulere", [
    ["Iganmu"], ["Orile Iganmu", ["Orile"]], ["Surulere"], ["Aguda"], ["Ijesha"], ["Itire"], ["Lawanson"], ["Bode Thomas"],
    ["Ojuelegba"], ["Costain"], ["Apapa"], ["Ijora"], ["Mile 2", ["Mile Two"]], ["Festac Town", ["Festac", "Amuwo Odofin"]],
    ["Satellite Town"], ["Ajegunle"], ["Alaba"], ["Trade Fair"], ["Ojo"], ["Badagry"], ["Ikate Surulere"], ["Adeniran Ogunsanya"],
    ["Masha"], ["Shitta"], ["Western Avenue"], ["Akerele"], ["Gbaja"], ["Coker"], ["Eric Moore"], ["Ijeshatedo"], ["Barracks"],
  ]),
  ...build("mainland", [
    ["Yaba"], ["Ebute Metta", ["Ebute-Metta"]], ["Oyingbo"], ["Ikeja"], ["GRA Ikeja", ["Ikeja GRA"]], ["Maryland"], ["Anthony", ["Anthony Village"]],
    ["Gbagada"], ["Ojota"], ["Ketu"], ["Mile 12", ["Mile Twelve"]], ["Ikorodu"], ["Ojodu Berger", ["Ojodu", "Berger"]], ["Ogba"],
    ["Agege"], ["Ifako-Ijaiye", ["Ifako", "Ijaiye"]], ["Alagbado"], ["Egbeda"], ["Idimu"], ["Ikotun"], ["Igando"], ["Ipaja"],
    ["Iyana Ipaja"], ["Alimosho"], ["Isheri"], ["Magodo"], ["Omole"], ["Akowonjo"], ["Dopemu"], ["Oshodi"], ["Isolo"], ["Okota"],
    ["Ejigbo"], ["Mushin"], ["Palmgrove", ["Palm Grove"]], ["Shomolu", ["Somolu"]], ["Bariga"], ["Ilupeju"], ["Ikosi"],
    ["Ogudu"], ["Oworonshoki"], ["Ilasamaja"], ["Opebi"], ["Allen Avenue", ["Allen"]], ["Oregun"], ["Agidingbi"], ["Abule Egba"],
    ["Iju"], ["Egbe"], ["Ajao Estate"], ["Mafoluku"], ["Akoka"], ["Lagos Mainland", ["Mainland"]],
  ]),
  ...build("island-lekki", [
    ["Victoria Island", ["VI", "V.I."]], ["Ikoyi"], ["Lagos Island"], ["Obalende"], ["Marina"], ["Lekki"], ["Lekki Phase 1", ["Phase 1", "Lekki Phase One"]],
    ["Ikate"], ["Chevron"], ["Oniru"], ["Osapa London", ["Osapa"]], ["Agungi"], ["Ajah"], ["Sangotedo"], ["Abraham Adesanya"],
    ["Awoyaya"], ["Lakowe"], ["Ibeju-Lekki", ["Ibeju Lekki"]], ["Epe"], ["Banana Island"], ["Eko Atlantic"], ["Ilasan"], ["Jakande"],
    ["Igbo Efon"], ["Itedo"], ["Ologolo"], ["Ado Ajah"], ["Badore"], ["Elegushi"], ["Ikota"], ["Orchid Road", ["Orchid"]],
  ]),
  ...build("other-nigeria", [
    ["Abuja", ["FCT", "Gwarinpa", "Wuse", "Maitama", "Garki", "Lugbe", "Kubwa"]], ["Port Harcourt", ["PH", "Rivers"]], ["Ibadan"], ["Abeokuta"],
    ["Sagamu"], ["Ota", ["Sango Ota", "Sango-Ota"]], ["Mowe"], ["Ibafo"], ["Arepo"], ["Ilorin"], ["Benin City", ["Benin"]], ["Warri"], ["Asaba"],
    ["Enugu"], ["Onitsha"], ["Owerri"], ["Aba"], ["Uyo"], ["Calabar"], ["Akure"], ["Ado Ekiti"], ["Osogbo"], ["Ile-Ife", ["Ife"]],
    ["Ijebu Ode"], ["Kano"], ["Kaduna"], ["Jos"], ["Abakaliki"], ["Lokoja"], ["Makurdi"], ["Yola"], ["Maiduguri"], ["Sokoto"],
    ["Awka"], ["Umuahia"], ["Minna"], ["Bauchi"], ["Gombe"], ["Katsina"], ["Ogun State", ["Ogun"]],
  ]),
  ...build("abroad", [
    ["United Kingdom", ["UK", "England", "Britain", "London", "Manchester", "Birmingham", "Leeds", "Scotland", "Wales"]],
    ["United States", ["USA", "US", "America", "Houston", "Atlanta", "New York", "Dallas", "Texas", "California", "Chicago"]],
    ["Canada", ["Toronto", "Calgary", "Ottawa", "Vancouver"]], ["Ghana", ["Accra"]], ["South Africa", ["Johannesburg", "Cape Town"]],
    ["Ireland", ["Dublin"]], ["Germany"], ["France"], ["Netherlands", ["Holland"]],
    ["United Arab Emirates", ["UAE", "Dubai", "Abu Dhabi"]], ["Australia", ["Sydney", "Melbourne"]], ["Kenya", ["Nairobi"]],
    ["Rwanda", ["Kigali"]], ["Qatar"], ["Saudi Arabia"], ["Spain"], ["Italy"], ["Sweden"], ["Norway"], ["China"], ["Malaysia"],
    ["India"], ["New Zealand"], ["Belgium"], ["Cameroon"], ["Senegal"], ["Sierra Leone"], ["Gambia"],
  ]),
];

/** Lowercase, no accents, letters and digits only: "Ile-Ife" and "ile ife" meet in the middle. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INDEXED = AREAS.map((area, order) => ({
  area,
  order,
  names: [area.name, ...(area.aliases ?? [])].map(normalise).filter(Boolean),
}));

/** Up to `limit` places that fit what has been typed so far, best first. */
export function matchAreas(query: string, limit = 6): Area[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const scored: { area: Area; score: number; order: number }[] = [];
  for (const { area, order, names } of INDEXED) {
    let best = 0;
    for (const n of names) {
      if (n === q) best = Math.max(best, 100);
      else if (n.startsWith(q)) best = Math.max(best, 80);
      else if (n.split(" ").some((w) => w.startsWith(q))) best = Math.max(best, 60);
      else if (q.length >= 3 && n.includes(q)) best = Math.max(best, 40);
    }
    if (best > 0) scored.push({ area, score: best, order });
  }
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map((s) => s.area);
}

/** The place with exactly this name or nickname, if any. */
export function areaNamed(text: string): Area | null {
  const q = normalise(text);
  if (!q) return null;
  return INDEXED.find(({ names }) => names.includes(q))?.area ?? null;
}

export function areaBySlug(slug: string | undefined): Area | null {
  return (slug && AREAS.find((a) => a.slug === slug)) || null;
}

const LIVES = "(?:live|lives|living|stay|stays|staying|based|reside|resides|residing|located|settled|moved to|relocated to|from)";

/**
 * Finds where someone says they live in their season story ("we live in Yaba"). Only places said right after
 * a word like "live" or "based" count, so "I work in Victoria Island" does not move anyone house.
 */
export function areaFromStory(story: string): Area | null {
  const text = ` ${normalise(story)} `;
  let found: { area: Area; at: number; len: number } | null = null;
  for (const { area, names } of INDEXED) {
    for (const n of names) {
      if (n.length < 3) continue;
      const re = new RegExp(`${LIVES}(?: in| at| around| near| around the)?(?: the)? ${n} `);
      const hit = re.exec(text);
      if (hit && (!found || n.length > found.len)) found = { area, at: hit.index, len: n.length };
    }
  }
  return found?.area ?? null;
}
