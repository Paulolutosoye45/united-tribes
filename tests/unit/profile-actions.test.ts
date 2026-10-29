import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What each My page action asks the website to draw again. The "Still right?" strip lives on Home and shows its own thanks for a few seconds, so its
 * actions must not redraw Home at once (that removes the strip, and the thanks with it); My page and the Lead page are redrawn as before.
 */
const run = vi.fn();
vi.mock("@/lib/admin/rpc", () => ({ run: (...args: unknown[]) => run(...args) }));

import { myPageAnswerAction, myPageSaveAction, stillRightLaterAction } from "@/app/(app)/my/actions";

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue({ ok: true, data: { ok: true, outcome: "confirmed" } });
});

describe("the pages each My page action redraws", () => {
  it("redraws My page, the Lead page and Home after an answer given on My page", async () => {
    await myPageAnswerAction("age_range", "yes", null);
    expect(run).toHaveBeenCalledWith("my_page_answer", { p_key: "age_range", p_action: "yes", p_value: null }, ["/my", "/lead", "/home"]);
  });

  it("does not redraw Home after an answer given from the Home strip, which draws itself again a few seconds later", async () => {
    await myPageAnswerAction("life_stage", "yes", null, true);
    expect(run).toHaveBeenCalledWith("my_page_answer", { p_key: "life_stage", p_action: "yes", p_value: null }, ["/my", "/lead"]);
  });

  it("does not redraw Home for \"Not now\" either", async () => {
    await stillRightLaterAction("age_range");
    expect(run).toHaveBeenCalledWith("still_right_later", { p_key: "age_range" }, []);
  });

  it("redraws only My page after a typed fact or a line of the person's story", async () => {
    await myPageSaveAction("preferred_name", "Ezinne");
    expect(run).toHaveBeenCalledWith("my_page_save", { p_key: "preferred_name", p_value: "Ezinne" }, ["/my"]);
  });

  it("refuses a key it does not know without asking the database", async () => {
    expect(await stillRightLaterAction("birthday")).toMatchObject({ ok: false });
    expect(await myPageAnswerAction("birthday", "yes", null, true)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await myPageSaveAction("age_range", "26-32")).toMatchObject({ ok: false, reason: "invalid" });
    expect(run).not.toHaveBeenCalled();
  });
});
