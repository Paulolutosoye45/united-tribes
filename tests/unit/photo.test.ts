import { describe, expect, it } from "vitest";
import { PHOTO_SIDE, centredSquare, fitWithin } from "@/lib/photo/resize";

describe("portrait sizing", () => {
  it("never makes a small picture bigger", () => {
    expect(fitWithin(300, 300)).toEqual({ width: 300, height: 300 });
  });

  it("shrinks a big picture so its longest side is the limit", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_SIDE, height: 360 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 360, height: PHOTO_SIDE });
  });

  it("copes with an empty picture", () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
  });

  it("crops the middle square", () => {
    expect(centredSquare(400, 300)).toEqual({ x: 50, y: 0, size: 300 });
    expect(centredSquare(300, 400)).toEqual({ x: 0, y: 50, size: 300 });
    expect(centredSquare(300, 300)).toEqual({ x: 0, y: 0, size: 300 });
  });
});
