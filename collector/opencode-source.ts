/**
 * opencode / qalcode2 token-usage source adapter.
 *
 * The whole point of Claude Pulse is "tokens per minute". Those numbers require
 * per-request token counts. If you don't route traffic through the collector
 * proxy, the proxy log has none — BUT opencode/qalcode2 already records every
 * assistant message's token usage in its local SQLite DB:
 *
 *   ~/.local/share/opencode/opencode.db   →  table `message`
 *   each row: time_created (epoch ms) + data JSON containing
 *     { role:"assistant", tokens:{input,output,cache:{read,write}}, cost, modelID }
 *
 * This adapter reads NEW assistant messages from that DB on an interval and
 * appends them to claude-pulse's usage.jsonl as `kind:"request"` lines — so the
 * tokens/min gauge + usage-over-time graph populate from your REAL qalcode2
 * usage, with no proxy and no credentials. Read-only; never touches the DB.
 *
 * Uses bun:sqlite (built in). No external deps.
 */

import { appendFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { existsSync } from "fs";

const OC_DB =
  process.env["CLAUDE_PULSE_OPENCODE_DB"] ??
  path.join(
    process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share"),
    "opencode",
    "opencode.db",
  );

// Track the last message time we've already imported (epoch ms). We persist it
// in-memory; on first run we only import the recent past so we don't dump the
// entire history (the DB can hold tens of thousands of messages).
let lastImported = 0;
let initialized = false;

type TokenLine = {
  t: number;
  kind: "request";
  status: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
  model?: string;
  rateLimited: boolean;
  durationMs: number;
  source: "opencode-db";
};

function openDb(): any | null {
  if (!existsSync(OC_DB)) return null;
  try {
    // dynamic import so environments without bun:sqlite still load the module
    // (it's always present under Bun, but be defensive)
    // @ts-ignore
    const { Database } = require("bun:sqlite");
    return new Database(OC_DB, { readonly: true });
  } catch {
    return null;
  }
}

/**
 * Read assistant messages newer than `since` (epoch ms) and return token lines.
 * `lookbackMs` bounds the very first import so we don't replay all of history.
 */
function readNewMessages(
  db: any,
  since: number,
  lookbackMs: number,
): TokenLine[] {
  const floor = since > 0 ? since : Date.now() - lookbackMs;
  let rows: any[];
  try {
    rows = db
      .query(
        "SELECT time_created, data FROM message WHERE time_created > ? ORDER BY time_created ASC LIMIT 2000",
      )
      .all(floor);
  } catch {
    return [];
  }
  const out: TokenLine[] = [];
  for (const r of rows) {
    let d: any;
    try {
      d = JSON.parse(r.data);
    } catch {
      continue;
    }
    if (d.role !== "assistant") continue;
    const tok = d.tokens;
    if (!tok) continue;
    const input = Number(tok.input ?? 0);
    const output = Number(tok.output ?? 0);
    const cacheRead = Number(tok.cache?.read ?? 0);
    const cacheWrite = Number(tok.cache?.write ?? 0);
    // skip empty rows (no actual usage)
    if (input + output + cacheRead + cacheWrite === 0) continue;
    out.push({
      t: Number(r.time_created),
      kind: "request",
      status: 200,
      input,
      output,
      cacheRead,
      cacheWrite,
      cost: Number(d.cost ?? 0),
      model: d.modelID ?? d.model ?? undefined,
      rateLimited: false,
      durationMs: 0,
      source: "opencode-db",
    });
  }
  return out;
}

/**
 * Poll the opencode DB once; append any new token lines to `logFile`.
 * Returns the number of new lines written.
 */
export async function importOpencodeUsage(
  logFile: string,
  firstRunLookbackMs = 7 * 24 * 60 * 60 * 1000, // 7 days on first run
): Promise<number> {
  const db = openDb();
  if (!db) return 0;
  try {
    const lines = readNewMessages(
      db,
      initialized ? lastImported : 0,
      firstRunLookbackMs,
    );
    initialized = true;
    if (lines.length === 0) return 0;
    // advance the cursor
    lastImported = Math.max(lastImported, ...lines.map((l) => l.t));
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    await appendFile(logFile, text);
    return lines.length;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

export function opencodeDbPath(): string {
  return OC_DB;
}
export function opencodeDbExists(): boolean {
  return existsSync(OC_DB);
}

// Standalone: `bun run collector/opencode-source.ts`
if (import.meta.main) {
  const { mkdir } = await import("fs/promises");
  const DATA_DIR = path.join(
    process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share"),
    "claude-pulse",
  );
  await mkdir(DATA_DIR, { recursive: true });
  const LOG = path.join(DATA_DIR, "usage.jsonl");
  if (!opencodeDbExists()) {
    console.error(`[claude-pulse] opencode DB not found at ${OC_DB}`);
    process.exit(1);
  }
  const n = await importOpencodeUsage(LOG);
  console.log(`[claude-pulse] imported ${n} token lines from ${OC_DB}`);
}
