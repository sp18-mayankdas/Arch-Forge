import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { WS_URL } from "./config";
import type { ChatMessage } from "@/types/canvas";
import { getMaps } from "./semantic-ops";

const USER_COLORS = [
  "#52A8FF", "#BF7AF0", "#FF990A", "#FF6166",
  "#F75F8F", "#62C073", "#0AC7B4", "#FFD166",
];

export interface UserInfo {
  userId: string;
  name: string;
  color: string;
}

/**
 * A stable colour for an account.
 *
 * Hashed from the GitHub login rather than picked at random, so the same person is the same
 * colour in every room, on every device, for everyone watching. Presence colours are how
 * collaborators tell each other apart mid-session; one that changed on reload would undo that.
 */
function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * Presence identity for the signed-in user.
 *
 * `userId` is deliberately NOT the account id: it identifies a TAB, and two tabs open on the
 * same board are two cursors. useYjsSync keys collaborators on it, so sharing one id between
 * tabs would make them collapse into a single flickering peer. Identity for access control
 * lives in the session cookie; this is only for drawing cursors and avatars.
 */
export function getUserInfo(account: { login: string; name: string | null }): UserInfo {
  return {
    userId: `${account.login}-${Math.random().toString(36).slice(2, 9)}`,
    name: account.name?.trim() || account.login,
    color: colorFor(account.login),
  };
}

export interface Room {
  doc: Y.Doc;
  provider: WebsocketProvider;
  // nodes/edges/positions/ops are reached through getMaps(doc), not held here.
  // The transcript is not part of that split, so it keeps its own handle.
  messagesArray: Y.Array<ChatMessage>;
  user: UserInfo;
}

// One room (and therefore one WebSocket connection) per roomId per page.
// React 18 StrictMode double-invokes render/useMemo in dev; without this cache
// that would open a second connection and show a phantom extra collaborator.
const roomCache = new Map<string, Room>();

export function createRoom(roomId: string, account: { login: string; name: string | null }): Room {
  const cached = roomCache.get(roomId);
  if (cached) return cached;

  const doc = new Y.Doc();
  // Same-origin through the Vite proxy by default (see lib/config.ts). That is required,
  // not cosmetic: the session is an httpOnly cookie and the browser only attaches it to the
  // WebSocket upgrade when the socket shares the page's origin. Point VITE_WS_URL at another
  // host and the upgrade arrives with no cookie, so the server answers 401.
  const provider = new WebsocketProvider(WS_URL, roomId, doc, { connect: true });

  // Touch the shared types up front so they exist before the first sync message.
  // Consumers go through getMaps(doc) rather than holding references.
  getMaps(doc);
  const messagesArray = doc.getArray<ChatMessage>("messages");

  const user = getUserInfo(account);
  provider.awareness.setLocalStateField("user", user);
  provider.awareness.setLocalStateField("cursor", null);
  // Initialised here, alongside cursor, so a peer who joins mid-session never reads it as
  // undefined before this client has marked anything.
  provider.awareness.setLocalStateField("focus", []);

  const room: Room = { doc, provider, messagesArray, user };
  roomCache.set(roomId, room);
  return room;
}
