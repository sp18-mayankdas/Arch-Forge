import { describe, it, expect } from "vitest";
import { toChatHistory } from "./ai-history";
import type { ClarifyQuestion } from "@archforge/shared";

const question: ClarifyQuestion = {
  header: "H",
  question: "Which?",
  multiSelect: false,
  options: [
    { label: "A", description: "a" },
    { label: "B", description: "b" },
  ],
};

describe("toChatHistory", () => {
  it("sends user turns with no `asked` key at all", () => {
    // Meaningless on a user turn, and the server only inspects assistant turns. toEqual, not
    // toMatchObject, so a stray key fails.
    expect(toChatHistory([{ role: "user", content: "hi" }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("marks an assistant turn that rendered questions as asked", () => {
    expect(
      toChatHistory([{ role: "assistant", content: "which?", questions: [question] }])
    ).toEqual([{ role: "assistant", content: "which?", asked: true }]);
  });

  it("marks an assistant turn that asked nothing as asked:false EXPLICITLY", () => {
    // The client-side twin of the server's absent-means-true rule: omitting the flag here
    // would silently suppress the next legitimate question. Asserted with toEqual so an
    // accidental omission fails rather than passing quietly.
    expect(toChatHistory([{ role: "assistant", content: "here you go" }])).toEqual([
      { role: "assistant", content: "here you go", asked: false },
    ]);
  });

  it("treats an empty questions array as not having asked", () => {
    expect(
      toChatHistory([{ role: "assistant", content: "drawn", questions: [] }])
    ).toEqual([{ role: "assistant", content: "drawn", asked: false }]);
  });

  it("preserves order and content across a full exchange", () => {
    const out = toChatHistory([
      { role: "user", content: "build a login system" },
      { role: "assistant", content: "which methods?", questions: [question] },
      { role: "user", content: "Sign-in: Google" },
      { role: "assistant", content: "drawn" },
    ]);
    expect(out.map((t) => t.content)).toEqual([
      "build a login system",
      "which methods?",
      "Sign-in: Google",
      "drawn",
    ]);
    expect(out.map((t) => t.asked)).toEqual([undefined, true, undefined, false]);
  });

  it("treats a local error turn as not having asked", () => {
    // The sidebar appends its own failure message as an assistant turn; it has no questions,
    // so it must not block the next question.
    expect(
      toChatHistory([{ role: "assistant", content: "Failed to generate architecture." }])[0].asked
    ).toBe(false);
  });
});
