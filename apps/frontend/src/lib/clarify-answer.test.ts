import { describe, it, expect } from "vitest";
import { foldAnswers, WAIVED, type ClarifyAnswerState } from "./clarify-answer";
import type { ClarifyQuestion } from "@/types/canvas";

const q = (header: string, multiSelect = false): ClarifyQuestion => ({
  header,
  question: `${header}?`,
  multiSelect,
  options: [
    { label: "A", description: "" },
    { label: "B", description: "" },
  ],
});

const state = (over: Partial<ClarifyAnswerState> = {}): ClarifyAnswerState => ({
  picked: {},
  other: {},
  skipped: {},
  ...over,
});

describe("foldAnswers", () => {
  it("folds one pick into a header-prefixed clause", () => {
    expect(
      foldAnswers([q("Sign-in methods")], state({ picked: { 0: ["Email + password"] } })),
    ).toBe("Sign-in methods: Email + password");
  });

  it("joins multi-select picks with commas", () => {
    expect(
      foldAnswers(
        [q("Sign-in methods", true)],
        state({ picked: { 0: ["Email", "Social login"] } }),
      ),
    ).toBe("Sign-in methods: Email, Social login");
  });

  it("joins several questions with a period, in question order", () => {
    expect(
      foldAnswers(
        [q("Sign-in methods"), q("Sessions")],
        state({ picked: { 0: ["Email"], 1: ["JWTs"] } }),
      ),
    ).toBe("Sign-in methods: Email. Sessions: JWTs");
  });

  it("appends free text after the picks", () => {
    expect(
      foldAnswers(
        [q("Sign-in methods", true)],
        state({ picked: { 0: ["Email"] }, other: { 0: "  magic links  " } }),
      ),
    ).toBe("Sign-in methods: Email, magic links");
  });

  it("sends free text alone when nothing was picked", () => {
    expect(foldAnswers([q("Scale")], state({ other: { 0: "about 5k daily users" } }))).toBe(
      "Scale: about 5k daily users",
    );
  });

  it("marks a skipped question waived, rather than dropping it", () => {
    // The backend prompt keys off this exact wording to treat the slot as resolved and stop
    // re-asking it. Dropping the question instead would leave the model unable to tell
    // "waived" from "never asked".
    expect(foldAnswers([q("Scale")], state({ skipped: { 0: true } }))).toBe(`Scale: ${WAIVED}`);
  });

  it("treats an unreached question as waived too, so the sentence is never empty", () => {
    expect(foldAnswers([q("Scale")], state())).toBe(`Scale: ${WAIVED}`);
  });

  it("mixes answered and waived questions in order", () => {
    expect(
      foldAnswers(
        [q("Sign-in methods"), q("Scale"), q("Integrations")],
        state({ picked: { 0: ["Email"], 2: ["Stripe"] }, skipped: { 1: true } }),
      ),
    ).toBe(`Sign-in methods: Email. Scale: ${WAIVED}. Integrations: Stripe`);
  });

  it("ignores whitespace-only free text", () => {
    expect(foldAnswers([q("Scale")], state({ other: { 0: "   " } }))).toBe(`Scale: ${WAIVED}`);
  });

  it("returns the empty string for no questions", () => {
    expect(foldAnswers([], state())).toBe("");
  });
});
