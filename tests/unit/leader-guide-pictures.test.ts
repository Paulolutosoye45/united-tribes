import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PICTURES } from "@/lib/messaging/templates-leader-welcome";

// The pictures in the leader welcome email are files in public/email/leader-guide, made by scripts/leader-guide-pictures.sh. The email
// says how big each one is; these checks make sure the files are there, are real pictures of that size (twice it, for sharp screens), are
// small enough to open on a weak connection, and that nothing else is left in the folder.

const DIR = join(__dirname, "../../public/email/leader-guide");
const MAX_BYTES = 100 * 1024;

function pngSize(file: string): { width: number; height: number } | null {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("the pictures in the leader welcome email", () => {
  const names = Object.keys(GUIDE_PICTURES);

  it("are at most eight, and the folder holds those and nothing else", () => {
    expect(names.length).toBeLessThanOrEqual(8);
    expect(existsSync(DIR)).toBe(true);
    expect(readdirSync(DIR).sort()).toEqual(names.map((n) => `${n}.png`).sort());
  });

  it.each(names)("%s is a real picture, twice the size the email shows, and under 100 KB", (name) => {
    const file = join(DIR, `${name}.png`);
    expect(existsSync(file)).toBe(true);
    const size = pngSize(file);
    expect(size, `${name}.png is not a PNG`).not.toBeNull();
    const shown = GUIDE_PICTURES[name as keyof typeof GUIDE_PICTURES];
    expect(size).toEqual({ width: shown.width * 2, height: shown.height * 2 });
    expect(statSync(file).size).toBeLessThan(MAX_BYTES);
  });

  it("each has a description for people who cannot see it", () => {
    for (const p of Object.values(GUIDE_PICTURES)) expect(p.alt.length).toBeGreaterThan(30);
  });
});
