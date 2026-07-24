import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { WS_URL } from "./config";

const USER_COLORS = [
  "#52A8FF", "#BF7AF0", "#FF990A", "#FF6166",
  "#F75F8F", "#62C073", "#0AC7B4", "#FFD166",
];

const ADJECTIVES = ["Swift", "Bright", "Calm", "Bold", "Keen", "Cool", "Wise", "Sharp"];
const NOUNS = ["Falcon", "Panda", "Tiger", "Lynx", "Fox", "Hawk", "Wolf", "Owl"];

function randomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export function getUserInfo() {
  // Always generate a fresh userId per page-load so duplicated tabs get unique identities
  const freshId = Math.random().toString(36).slice(2, 9);
  const stored = sessionStorage.getItem("archforge-user");
  const parsed = stored ? (JSON.parse(stored) as { name: string; color: string; userId: string }) : null;

  // Reuse name/color but always assign a new userId
  const info = {
    userId: freshId,
    name: parsed?.name ?? randomName(),
    color: parsed?.color ?? USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  };
  sessionStorage.setItem("archforge-user", JSON.stringify(info));
  return info;
}

export interface Room {
  doc: Y.Doc;
  provider: WebsocketProvider;
  nodesMap: Y.Map<Y.Map<unknown>>;
  edgesMap: Y.Map<Y.Map<unknown>>;
  user: ReturnType<typeof getUserInfo>;
}

// One room (and therefore one WebSocket connection) per roomId per page.
// React 18 StrictMode double-invokes render/useMemo in dev; without this cache
// that would open a second connection and show a phantom extra collaborator.
const roomCache = new Map<string, Room>();

export function createRoom(roomId: string): Room {
  const cached = roomCache.get(roomId);
  if (cached) return cached;

  const doc = new Y.Doc();
  // Connect straight to the backend Yjs WebSocket (no Vite proxy). The provider
  // appends the room id, so the backend receives ws://<host>/<roomId>.
  const provider = new WebsocketProvider(WS_URL, roomId, doc, { connect: true });

  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");

  const user = getUserInfo();
  provider.awareness.setLocalStateField("user", user);
  provider.awareness.setLocalStateField("cursor", null);

  const room: Room = { doc, provider, nodesMap, edgesMap, user };
  roomCache.set(roomId, room);
  return room;
}
