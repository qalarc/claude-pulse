/**
 * claude-pulse web dashboard — the "no-Tauri" path.
 *
 * Serves the SAME frontend (app/src) over HTTP plus a small JSON API that
 * mirrors the Tauri Rust commands (`snapshot`, `day_summaries`). This lets
 * anyone view their usage in a browser — on this machine or a phone on the
 * same LAN — without downloading or building the desktop app.
 *
 * It reads the exact same usage.jsonl the collector writes and the desktop
 * app reads. Metadata only — there are no credentials or prompt bodies in
 * that file, so nothing sensitive is ever served.
 *
 * Zero dependencies — pure Bun. Launched by proxy.ts when `--web` is passed,
 * or standalone:  bun run collector/web.ts
 */

import { readFile, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

const DATA_DIR = path.join(
  process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share"),
  "claude-pulse",
);
const LOG_FILE = path.join(DATA_DIR, "usage.jsonl");
const APP_DIR = path.join(import.meta.dir, "..", "app", "src");

const MIN_MS = 60_000;

type Raw = {
  t: number;
  status?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  rateLimited?: boolean;
  u5h?: number;
  u7d?: number;
  model?: string;
};

async function readLines(): Promise<Raw[]> {
  let text: string;
  try {
    text = await readFile(LOG_FILE, "utf8");
  } catch {
    return [];
  }
  const out: Raw[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

// ── snapshot: per-minute buckets for the last `windowMinutes` ────────────────
function buildSnapshot(lines: Raw[], windowMinutes: number) {
  const now = Date.now();
  const cutoff = now - windowMinutes * MIN_MS;
  const buckets = new Map<number, any>();
  let latestU5h = 0,
    latestU7d = 0,
    latestT = 0;

  for (const l of lines) {
    if (l.t > latestT) {
      latestT = l.t;
      if (typeof l.u5h === "number") latestU5h = l.u5h;
      if (typeof l.u7d === "number") latestU7d = l.u7d;
    }
    if (l.t < cutoff) continue;
    const minute = Math.floor(l.t / MIN_MS) * MIN_MS;
    let b = buckets.get(minute);
    if (!b) {
      b = {
        minute,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        requests: 0,
        rate_limited: 0,
        u5h: 0,
        u7d: 0,
      };
      buckets.set(minute, b);
    }
    b.input += l.input ?? 0;
    b.output += l.output ?? 0;
    b.cache_read += l.cacheRead ?? 0;
    b.cache_write += l.cacheWrite ?? 0;
    b.requests += 1;
    if (l.rateLimited || l.status === 429) b.rate_limited += 1;
    if (typeof l.u5h === "number" && l.u5h > b.u5h) b.u5h = l.u5h;
    if (typeof l.u7d === "number" && l.u7d > b.u7d) b.u7d = l.u7d;
  }

  const minutes = [...buckets.values()].sort((a, b) => a.minute - b.minute);

  let peak_tokens = 0,
    peak_minute = 0,
    peak_requests = 0,
    peak_requests_minute = 0,
    rate_limited_total = 0;
  for (const b of minutes) {
    const tok = b.input + b.output;
    if (tok > peak_tokens) {
      peak_tokens = tok;
      peak_minute = b.minute;
    }
    if (b.requests > peak_requests) {
      peak_requests = b.requests;
      peak_requests_minute = b.minute;
    }
    rate_limited_total += b.rate_limited;
  }

  return {
    minutes,
    peak_tokens,
    peak_minute,
    peak_requests,
    peak_requests_minute,
    rate_limited_total,
    latest_u5h: latestU5h,
    latest_u7d: latestU7d,
    log_path: LOG_FILE,
    has_data: lines.length > 0,
  };
}

// ── day_summaries: per-day rollups for the last `days` days ──────────────────
function localDay(ms: number): string {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function buildDays(lines: Raw[], days: number) {
  const cutoff = Date.now() - days * 24 * 60 * MIN_MS;
  const dayMap = new Map<string, any>();
  const dayMinute = new Map<string, number>(); // `${day}|${minute}` -> tokens

  for (const l of lines) {
    if (l.t < cutoff) continue;
    const day = localDay(l.t);
    let s = dayMap.get(day);
    if (!s) {
      s = {
        day,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        requests: 0,
        rate_limited: 0,
        peak_tpm: 0,
      };
      dayMap.set(day, s);
    }
    const inp = l.input ?? 0;
    const out = l.output ?? 0;
    s.input += inp;
    s.output += out;
    s.cache_read += l.cacheRead ?? 0;
    s.cache_write += l.cacheWrite ?? 0;
    s.requests += 1;
    if (l.rateLimited || l.status === 429) s.rate_limited += 1;
    const minute = Math.floor(l.t / MIN_MS) * MIN_MS;
    const key = `${day}|${minute}`;
    dayMinute.set(key, (dayMinute.get(key) ?? 0) + inp + out);
  }

  for (const [key, tpm] of dayMinute) {
    const day = key.split("|")[0];
    const s = dayMap.get(day);
    if (s && tpm > s.peak_tpm) s.peak_tpm = tpm;
  }

  return [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ── static file serving for app/src ──────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(pathname: string): Promise<Response> {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // prevent path traversal
  const safe = path
    .normalize(rel)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const file = path.join(APP_DIR, safe);
  if (!file.startsWith(APP_DIR)) return new Response("forbidden", { status: 403 });
  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    return new Response(data, {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export function startWeb(port: number): void {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;

      if (p === "/api/health") return json({ ok: true, log: LOG_FILE });

      if (p === "/api/snapshot") {
        const minutes = Math.max(
          1,
          Math.min(1440, Number(url.searchParams.get("minutes") ?? 60)),
        );
        return json(buildSnapshot(await readLines(), minutes));
      }

      if (p === "/api/days") {
        const days = Math.max(
          1,
          Math.min(365, Number(url.searchParams.get("days") ?? 35)),
        );
        return json(buildDays(await readLines(), days));
      }

      // everything else: static frontend
      return serveStatic(p);
    },
  });

  console.log(
    `[claude-pulse] web dashboard on http://localhost:${server.port}`,
  );
  console.log(
    `[claude-pulse]   open it in any browser (or on your phone via this machine's LAN IP)`,
  );
}

// Allow standalone: `bun run collector/web.ts [port]`
if (import.meta.main) {
  const portArg = process.argv[2];
  const port = Number(
    portArg ?? process.env["CLAUDE_PULSE_WEB_PORT"] ?? 8788,
  );
  // sanity-check app dir exists
  try {
    await stat(path.join(APP_DIR, "index.html"));
  } catch {
    console.error(
      `[claude-pulse] cannot find frontend at ${APP_DIR} — run from the repo.`,
    );
    process.exit(1);
  }
  startWeb(port);
}
