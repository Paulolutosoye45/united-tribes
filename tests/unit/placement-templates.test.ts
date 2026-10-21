import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import {
  PLACEMENT_SAMPLES,
  PLACEMENT_TEMPLATES,
} from "@/lib/messaging/templates-placement";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";
const SECRET =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const keys = PLACEMENT_TEMPLATES.map((t) => t.key);

function message(
  template: string,
  params: Params,
  token: string | null = null,
): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: token,
    to: {
      email: "ada@example.org",
      phone: null,
      name: "Ada Okafor",
      first_name: "Ada",
    },
  };
}

const sql = [
  "20261226000100_auto_placement.sql",
  "20261226000200_assistant_recommendations.sql",
]
  .map((f) =>
    readFileSync(join(__dirname, "../../supabase/migrations", f), "utf8"),
  )
  .join("\n");

// Words that would mean a message leaks something it must not: the owner, a score, or anything a member told us in private.
const PRIVATE =
  /god mode|owner|super ?admin|faith journey|growing in faith|new to faith|support need|care flag|percent|%|degree|score|\bage\b|\bgender\b/i;

describe("the placement, bulk-leader and assistant emails", () => {
  it("are the ten the feature needs, each registered with the sender and sent by email only", () => {
    expect(keys).toEqual([
      "placement_your_tribe",
      "placement_reminder",
      "placement_withheld",
      "placement_your_team",
      "placement_leader_appointed",
      "assistant_decided",
      "assistant_invited",
      "assistant_paired",
      "assistant_replaced",
      "office_assistant_recommended",
    ]);
    for (const key of keys) {
      expect(TEMPLATES[key], key).toBeDefined();
      expect(TEMPLATES[key].emailOnly, key).toBe(true);
      expect(PLACEMENT_SAMPLES[key], key).toBeDefined();
    }
  });

  it("are all queued by the database, and the database queues no placement or assistant email without wording", () => {
    for (const key of keys) expect(sql, key).toContain(`'${key}'`);
    const queued = new Set(
      [
        ...sql.matchAll(
          /enqueue_message\(\s*[^,]+,\s*'((?:placement|assistant)_[a-z_]+)'/g,
        ),
      ].map((m) => m[1]),
    );
    expect([...queued].filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each(keys)(
    "%s renders from the fields the database gives, with a short subject and links only to our own site",
    (key) => {
      const mail = renderEmail(
        message(key, PLACEMENT_SAMPLES[key], SECRET),
        SITE,
      );
      expect(mail.subject.length).toBeGreaterThan(8);
      expect(mail.subject.length).toBeLessThan(80);
      for (const text of [mail.subject, mail.text, mail.html])
        expect(text).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
      for (const url of mail.text.match(/https?:\/\/\S+/g) ?? []) {
        expect(
          url.startsWith(SITE) || url.startsWith("https://chat.whatsapp.com/"),
          url,
        ).toBe(true);
      }
      expect(mail.text).toContain("Hi Ada,");
    },
  );

  it.each(keys)(
    "%s still renders when the database sends nothing at all",
    (key) => {
      const mail = renderEmail(message(key, {}), SITE);
      expect(mail.subject.length).toBeGreaterThan(5);
      for (const text of [mail.subject, mail.text])
        expect(text).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
    },
  );

  it.each(keys)(
    "%s never names the owner, a score or anything private, even when the fields carry it",
    (key) => {
      const hostile: Params = {
        ...PLACEMENT_SAMPLES[key],
        faith_journey: "new-to-faith",
        support_need: "grief",
        age: "13-17",
        gender: "female",
        degree: 91,
        score: 91,
        care_note: "Told us she is struggling",
        owner: "The Owner",
        decided_by: "The Owner",
        note: "Not this season, we are waiting on references",
      };
      const mail = renderEmail(message(key, hostile, SECRET), SITE);
      const body = `${mail.subject}\n${mail.text}`;
      expect(body).not.toMatch(PRIVATE);
      expect(body).not.toMatch(
        /grief|struggling|references|new-to-faith|13-17/i,
      );
    },
  );
});

describe("Your tribe", () => {
  it("carries three links to the private page when the database made a secret, each with its answer ready", () => {
    const mail = renderEmail(
      message(
        "placement_your_tribe",
        PLACEMENT_SAMPLES.placement_your_tribe,
        SECRET,
      ),
      SITE,
    );
    expect(mail.text).toContain(`${SITE}/placed/${SECRET}?a=confirm`);
    expect(mail.text).toContain(`${SITE}/placed/${SECRET}?a=change`);
    expect(mail.text).toContain(`${SITE}/placed/${SECRET}?a=withhold`);
    expect(mail.html).toContain("Yes, I’m in");
    expect(mail.html).toContain("Show me other tribes");
    expect(mail.html).toContain("Don’t share my details");
  });

  it("falls back to the signed-in page when there is no secret, and offers no private links", () => {
    const mail = renderEmail(
      message(
        "placement_your_tribe",
        PLACEMENT_SAMPLES.placement_your_tribe,
        null,
      ),
      SITE,
    );
    expect(mail.text).not.toContain("/placed/");
    expect(mail.text).toContain(`${SITE}/tribe`);
    expect(mail.html).toContain("See my tribe");
  });

  it("says in one plain sentence what the leader will be given, and names the leader and the time and place", () => {
    const mail = renderEmail(
      message(
        "placement_your_tribe",
        PLACEMENT_SAMPLES.placement_your_tribe,
        SECRET,
      ),
      SITE,
    );
    expect(mail.text).toMatch(/leader|Ngozi/);
    expect(mail.text).toMatch(/Ngozi and Dayo/);
    expect(mail.text).toMatch(/Wednesday|Wed/i);
    expect(mail.text).toMatch(/email|WhatsApp/i);
  });

  it("does not list the other people in the tribe", () => {
    const mail = renderEmail(
      message(
        "placement_your_tribe",
        {
          ...PLACEMENT_SAMPLES.placement_your_tribe,
          members: [{ name: "Secret Person" }],
          partners: ["Secret Person"],
        },
        SECRET,
      ),
      SITE,
    );
    expect(mail.text).not.toContain("Secret Person");
  });
});

describe("Your team", () => {
  const members = [
    {
      name: "Ada",
      email: "ada@example.org",
      whatsapp: "+2348031234567",
      withheld: false,
    },
    { name: "Bayo", email: "", whatsapp: "", withheld: true },
    { name: "Chi", email: "chi@example.org", whatsapp: "", withheld: false },
  ];

  it("gives a name, an email and a WhatsApp number for each member, and says plainly when a member's details are withheld", () => {
    const mail = renderEmail(
      message("placement_your_team", {
        tribe: "Builders Tribe",
        members,
        first_meeting_by: "2027-03-01",
        call_by: "2027-02-20",
      }),
      SITE,
    );
    expect(mail.text).toContain("Ada, ada@example.org, +2348031234567");
    expect(mail.text).toContain("Chi, chi@example.org");
    expect(mail.text).toContain(
      "Bayo: contact withheld; they have your details",
    );
    expect(mail.text).not.toMatch(/Bayo,/);
    expect(mail.text).toMatch(/3 members/);
  });

  it("carries only what it is meant to, whatever else the member row holds", () => {
    const rows = members.map((m) => ({
      ...m,
      faith: "new",
      age: "13-17",
      need: "grief",
      degree: 90,
      birthday: "2001-01-01",
    }));
    const mail = renderEmail(
      message("placement_your_team", {
        tribe: "Builders Tribe",
        members: rows,
      }),
      SITE,
    );
    expect(mail.text).not.toMatch(/new\b|13-17|grief|90|2001|birthday/);
  });

  it("lists names only in a rehearsal, with no email or number", () => {
    const mail = renderEmail(
      message("placement_your_team", {
        tribe: "Builders Tribe",
        members,
        rehearsal: true,
      }),
      SITE,
    );
    expect(mail.text).toContain("Ada");
    expect(mail.text).not.toContain("ada@example.org");
    expect(mail.text).not.toContain("+2348031234567");
  });

  it("is safe with a hostile member list: not a list, rows that are not objects, long values", () => {
    for (const bad of [
      "x",
      7,
      null,
      [null, 4, "z"],
      [
        {
          name: "A".repeat(500),
          email: "e@example.org\r\nBcc: x@evil.example",
        },
      ],
    ]) {
      const mail = renderEmail(
        message("placement_your_team", { tribe: "T", members: bad }),
        SITE,
      );
      expect(mail.text).not.toMatch(/undefined|\[object/);
      expect(mail.text).not.toMatch(/\nBcc:/);
      expect(mail.text.length).toBeLessThan(3000);
    }
  });
});

describe("the leader, the assistant and the office", () => {
  it("says the outcome in a line and never the office's reason", () => {
    for (const outcome of ["approved", "invited", "declined", "expired"]) {
      const mail = renderEmail(
        message("assistant_decided", {
          tribe: "Builders Tribe",
          outcome,
          assistant_first: "Ada",
          note: "private reason",
        }),
        SITE,
      );
      expect(mail.text).not.toContain("private reason");
      expect(mail.subject.length).toBeGreaterThan(8);
    }
    expect(
      renderEmail(
        message("assistant_decided", {
          tribe: "T",
          outcome: "approved",
          assistant_first: "Ada",
        }),
        SITE,
      ).text,
    ).toContain("Ada");
  });

  it("sends the office only to its own Assistants page, whatever path the fields hold", () => {
    for (const path of [
      "https://evil.example/x",
      "//evil.example",
      "/admin/assistants",
      "javascript:alert(1)",
    ]) {
      const mail = renderEmail(
        message("office_assistant_recommended", {
          tribe: "T",
          leader_first: "Ngozi",
          young: false,
          path,
        }),
        SITE,
      );
      for (const url of mail.text.match(/https?:\/\/\S+/g) ?? [])
        expect(url.startsWith(SITE), url).toBe(true);
      expect(mail.html).not.toContain("evil.example");
      expect(mail.html).not.toContain("javascript:");
    }
  });

  it("tells the office when a tribe has young members, and says nothing more about them", () => {
    const mail = renderEmail(
      message("office_assistant_recommended", {
        tribe: "T",
        leader_first: "Ngozi",
        young: true,
      }),
      SITE,
    );
    expect(mail.text).toMatch(/pastor or a director decides/);
    expect(mail.text).not.toMatch(/\b1[3-7]\b|minor|teen/i);
  });

  it("tells a leader they are appointed without a score, and says what is still theirs to do", () => {
    const mail = renderEmail(
      message(
        "placement_leader_appointed",
        PLACEMENT_SAMPLES.placement_leader_appointed,
      ),
      SITE,
    );
    expect(mail.text).toMatch(/Academy/);
    expect(mail.text).toMatch(/pastor reviews/i);
    expect(mail.text).not.toMatch(/\d{2,}/);
  });
});
