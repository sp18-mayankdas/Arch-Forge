import * as Y from "yjs";
import { prisma } from "./db";

// y-websocket's util module (CommonJS). We register a persistence provider so every
// room's Yjs document is loaded from / saved to Postgres, keyed by the room name —
// which is the project id. `docs` is the live in-memory map of open rooms.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yUtils = require("y-websocket/bin/utils") as {
  setPersistence: (p: {
    bindState: (docName: string, ydoc: Y.Doc) => void | Promise<void>;
    writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
  }) => void;
  docs: Map<string, Y.Doc>;
};

const SAVE_DEBOUNCE_MS = 1500;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Persist the full doc as one blob. updateMany (not upsert) means only rooms that are
// real projects get saved — a stray/legacy room id matches zero rows and is ignored.
async function persist(docName: string, ydoc: Y.Doc): Promise<void> {
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  await prisma.project.updateMany({ where: { id: docName }, data: { state } });
}

function scheduleSave(docName: string, ydoc: Y.Doc): void {
  const existing = saveTimers.get(docName);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    docName,
    setTimeout(() => {
      saveTimers.delete(docName);
      persist(docName, ydoc).catch((e) => console.error(`persist ${docName} failed:`, e));
    }, SAVE_DEBOUNCE_MS)
  );
}

export function setupPersistence(): void {
  yUtils.setPersistence({
    // Called once, the first time a room is opened. Load its saved state into the doc,
    // then persist (debounced) on every subsequent change.
    bindState: async (docName, ydoc) => {
      try {
        const row = await prisma.project.findUnique({
          where: { id: docName },
          select: { state: true },
        });
        if (row?.state) Y.applyUpdate(ydoc, new Uint8Array(row.state));
      } catch (e) {
        console.error(`load ${docName} failed:`, e);
      }
      ydoc.on("update", () => scheduleSave(docName, ydoc));
    },
    // Called when the last client disconnects. Flush immediately.
    writeState: async (docName, ydoc) => {
      const t = saveTimers.get(docName);
      if (t) {
        clearTimeout(t);
        saveTimers.delete(docName);
      }
      await persist(docName, ydoc);
    },
  });
}

// Save every open room. writeState only fires on last-client disconnect, so a
// server-wide shutdown/redeploy would otherwise lose unsaved changes — call this in shutdown().
export async function flushAllDocs(): Promise<void> {
  await Promise.all(
    Array.from(yUtils.docs.entries()).map(([name, doc]) =>
      persist(name, doc).catch((e) => console.error(`flush ${name} failed:`, e))
    )
  );
}
