import { describe, expect, it } from "vitest";
import {
  MAX_ROWS,
  readLeaderSheet,
  readLeaderText,
  SHEET_HEADER,
  type SheetCatalogue,
} from "@/lib/placement/sheet";

const catalogue: SheetCatalogue = {
  tracks: [
    { slug: "builders", name: "Builders" },
    { slug: "teens", name: "Teens" },
  ],
  communities: [
    {
      slug: "consulting",
      name: "Consulting",
      goals: [
        {
          slug: "build-a-steady-client-pipeline",
          title: "Build a steady client pipeline",
        },
        {
          slug: "land-my-first-three-clients",
          title: "Land my first three clients",
        },
      ],
    },
    {
      slug: "in-between-jobs",
      name: "In-between Jobs",
      goals: [
        {
          slug: "grow-a-network-that-opens-doors",
          title: "Grow a network that opens doors",
        },
      ],
    },
  ],
};

const HEAD =
  "Email\tStage of life\tHow they lead best\tCommunity\tGoal\tRelation\tCleared";
const read = (...lines: string[]) =>
  readLeaderText([HEAD, ...lines].join("\n"), catalogue);
const people = (r: ReturnType<typeof read>) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("reading the list of leaders to appoint", () => {
  it("reads a pasted list from a spreadsheet, with names in place of codes and any case", () => {
    const r = people(
      read(
        "Ada@Example.org\tBuilders\tConnection\tConsulting\tBuild a steady client pipeline\tReached it\tYes",
      ),
    );
    expect(r.problems).toEqual([]);
    expect(r.people).toEqual([
      {
        email: "ada@example.org",
        track: "builders",
        lead_best: "connection",
        community: "consulting",
        goal: "build-a-steady-client-pipeline",
        relation: "achieved",
        care_cleared: true,
      },
    ]);
  });

  it("reads a comma separated file, with the other words people use for the same thing", () => {
    const csv = [
      "E-mail,Track,Leadership style,Community,Season goal,Goal status,Pastor cleared",
      "bo@example.org,builders,Organising,consulting,land-my-first-three-clients,working on it,no",
    ].join("\n");
    const r = people(readLeaderText(csv, catalogue));
    expect(r.people[0]).toMatchObject({
      email: "bo@example.org",
      lead_best: "structure",
      relation: "pursuing",
      care_cleared: false,
    });
  });

  it("needs only the email, the stage of life and how they lead best", () => {
    const r = people(
      readLeaderText(
        [
          "Email,Stage of life,How they lead best",
          "x@example.org,Builders,teaching",
        ].join("\n"),
        catalogue,
      ),
    );
    expect(r.people).toEqual([
      {
        email: "x@example.org",
        track: "builders",
        lead_best: "teaching",
        care_cleared: false,
      },
    ]);
  });

  it("finds a goal by its title alone and fills in the community", () => {
    const r = people(
      read(
        "g@example.org\tBuilders\tdoing\t\tGrow a network that opens doors\tachieved\t",
      ),
    );
    expect(r.people[0]).toMatchObject({
      community: "in-between-jobs",
      goal: "grow-a-network-that-opens-doors",
    });
  });

  it("lists every row it cannot use with its line and a plain reason, and keeps the rest", () => {
    const r = people(
      read(
        "good@example.org\tBuilders\tconnection\t\t\t\t",
        "not-an-email\tBuilders\tconnection\t\t\t\t",
        "good@example.org\tBuilders\tconnection\t\t\t\t",
        "a@example.org\tAstronaut\tconnection\t\t\t\t",
        "b@example.org\tBuilders\tbossy\t\t\t\t",
        "c@example.org\tBuilders\tconnection\tAtlantis\t\t\t",
        "d@example.org\tBuilders\tconnection\tConsulting\tFly to the moon\t\t",
        "e@example.org\tBuilders\tconnection\tConsulting\tLand my first three clients\t\t",
        "f@example.org\tBuilders\tconnection\t\t\t\tmaybe",
      ),
    );
    expect(r.people.map((p) => p.email)).toEqual(["good@example.org"]);
    expect(r.problems.map((p) => p.text)).toEqual([
      "This is not an email address.",
      "This email is on the list twice.",
      "“Astronaut” is not a stage of life we have.",
      "Say how they lead best: structure, connection, teaching or doing.",
      "“Atlantis” is not a community we have.",
      "“Fly to the moon” is not a goal in that community.",
      "Say whether they reached that goal or are working on it.",
      "Cleared should be yes or no.",
    ]);
    expect(new Set(r.problems.map((p) => p.line)).size).toBe(r.problems.length);
  });

  it("skips blank rows and the example row from the template", () => {
    const r = people(
      read(
        "",
        "(Example) ada@example.org\tBuilders\tconnection\t\t\t\t",
        "real@example.org\tBuilders\tconnection\t\t\t\t",
      ),
    );
    expect(r.people.map((p) => p.email)).toEqual(["real@example.org"]);
    expect(r.problems).toEqual([]);
  });

  it("reads no more than 300 people and says so", () => {
    const rows = Array.from(
      { length: MAX_ROWS + 5 },
      (_, i) => `p${i}@example.org\tBuilders\tconnection\t\t\t\t`,
    );
    const r = people(read(...rows));
    expect(r.people).toHaveLength(MAX_ROWS);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].text).toMatch(/first 300/);
  });

  it("explains what is wrong with a list it cannot read at all", () => {
    expect(readLeaderText("", catalogue)).toEqual({
      ok: false,
      message: "Paste the list first.",
    });
    expect(readLeaderText("a,b,c\n1,2,3", catalogue)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/couldn’t find the columns/),
    });
    expect(
      readLeaderText("Email,Community\nx@example.org,Consulting", catalogue),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Stage of life/),
    });
    expect(readLeaderText(HEAD, catalogue)).toEqual({
      ok: false,
      message: "There is nobody on that list.",
    });
    expect(
      readLeaderText("x".repeat(3 * 1024 * 1024), catalogue),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/too much text/),
    });
  });

  it("refuses files it cannot read with a sentence that says what to do", () => {
    expect(
      readLeaderSheet("list.csv", Buffer.alloc(0), catalogue),
    ).toMatchObject({ ok: false, message: "That file is empty." });
    expect(
      readLeaderSheet(
        "list.csv",
        Buffer.alloc(2 * 1024 * 1024 + 1, 97),
        catalogue,
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/too large/) });
    for (const name of ["list.pdf", "list.docx", "list.xls", "photo.png"]) {
      expect(
        readLeaderSheet(name, Buffer.from("hello"), catalogue),
      ).toMatchObject({
        ok: false,
        message: expect.stringMatching(/Excel \(\.xlsx\) or CSV/),
      });
    }
    expect(
      readLeaderSheet(
        "list.xlsx",
        Buffer.from([0x50, 0x4b, 0x00, 0x00, 0x01]),
        catalogue,
      ),
    ).toMatchObject({ ok: false });
  });

  it("reads a CSV file given as bytes, with a byte order mark and Windows line ends", () => {
    const text =
      "﻿Email,Stage of life,How they lead best\r\nwin@example.org,Builders,connection\r\n";
    const r = readLeaderSheet(
      "people.csv",
      Buffer.from(text, "utf8"),
      catalogue,
    );
    expect(r.ok && r.people.map((p) => p.email)).toEqual(["win@example.org"]);
  });

  it("offers a header for the template that the reader itself understands", () => {
    const r = readLeaderText(
      [SHEET_HEADER.join(","), "t@example.org,Builders,structure,,,,"].join(
        "\n",
      ),
      catalogue,
    );
    expect(r.ok && r.people).toHaveLength(1);
  });

  it("does not let a cell break out: nothing it returns carries anything but the codes and the address", () => {
    const r = people(read("z@example.org\tBuilders\tconnection\t\t\t\t"));
    expect(Object.keys(r.people[0]).sort()).toEqual([
      "care_cleared",
      "email",
      "lead_best",
      "track",
    ]);
  });
});
