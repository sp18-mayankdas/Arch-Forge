import { describe, it, expect } from "vitest";
import { roomIdFromUrl } from "./rooms";

/**
 * These pin `roomIdFromUrl` against y-websocket's OWN derivation, which is the `docName`
 * default in `y-websocket/bin/utils.cjs`:
 *
 *   docName = (req.url || '').slice(1).split('?')[0]
 *
 * If the two ever disagree the upgrade guard authorizes one room and opens another — an
 * access check that looks like it is working while letting the wrong document through. That
 * is why `setupWSConnection` is handed an explicit docName rather than left to re-derive it.
 */
describe("roomIdFromUrl", () => {
  const yWebsocketDerivation = (url: string | undefined) =>
    decodeURIComponent((url ?? "").slice(1).split("?")[0]);

  it("matches y-websocket for a plain room path", () => {
    expect(roomIdFromUrl("/abc123")).toBe("abc123");
    expect(roomIdFromUrl("/abc123")).toBe(yWebsocketDerivation("/abc123"));
  });

  it("drops the query string, which y-websocket also ignores", () => {
    expect(roomIdFromUrl("/abc123?token=xyz")).toBe("abc123");
    expect(roomIdFromUrl("/abc123?token=xyz")).toBe(yWebsocketDerivation("/abc123?token=xyz"));
  });

  it("returns empty for the root path and for a missing url", () => {
    expect(roomIdFromUrl("/")).toBe("");
    expect(roomIdFromUrl(undefined)).toBe("");
  });

  it("decodes percent-encoding the same way", () => {
    expect(roomIdFromUrl("/a%20b")).toBe(yWebsocketDerivation("/a%20b"));
  });
});
