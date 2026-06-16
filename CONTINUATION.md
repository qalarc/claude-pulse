# Claude Pulse — Full Continuation Guide

**For the next agent (or human) picking this project up.** Read this top to bottom
before writing code. It explains what exists, what works, what's next, the hard
rules, and the exact commands to verify everything.

---

## 0. One-paragraph orientation

Claude Pulse is an open-source, local-first desktop app that visualizes Anthropic
Claude API usage — with an **accelerometer-style live gauge**, a per-minute
timeline (with peak + rate-limit markers), and a calendar. It works with ANY
Claude tool (Claude Code, qalcode2, scripts) because it captures usage at the
**network layer** via a small local proxy that logs **metadata only** to a file
the app reads. No cloud, no account, no credentials handled. The goal users care
about: **discover your effective per-minute rate limit by observing your own
traffic** (subscription/OAuth per-minute limits are undocumented).

---

## 1. The credential question (CRITICAL — understand this before touching anything)

**Viewing usage stats requires NO login and NO credential.** This is the core
design and a hard rule. The data comes from a local log file (`usage.jsonl`)
written as a side-effect of the user's normal Claude traffic passing through the
collector proxy. The dashboard is a **read-only viewer of that file** — it never
authenticates, never sees a token.

- The user's Anthropic token stays exactly where it already is (Claude Code config,
  env var, etc.). It is used by THEIR existing tools.
- The collector proxy **forwards** the token to Anthropic untouched and **never
  stores it**. It only reads response headers + the `usage` object.
- The dashboard reads numbers from a file. No keys involved.

**Two cases to keep distinct:**

- _Show stats_ → reads local file → no credential.
- _Make Claude requests_ → done by the user's existing tool with their existing
  token → not the dashboard's job.

**HARD RULE: never build anything that collects, stores, transmits, or asks for a
user's API key or OAuth token.** Not locally, not on a server, not "just to set
up." If a feature seems to need it, it's the wrong design — re-read this section.

---

## 2. Architecture

```
user's Claude tools ──(ANTHROPIC_BASE_URL=localhost:8787)──▶ collector proxy
                                                                  │ forwards to api.anthropic.com (token untouched)
                                                                  │ appends METADATA to usage.jsonl
                                                                  ▼
                                          ~/.local/share/claude-pulse/usage.jsonl
                                                                  │ read by
                                          ┌───────────────────────┴───────────────────┐
                                          ▼                                            ▼
                              Tauri app (Rust reads+aggregates)            (future) local web mode :8788
                              frontend renders gauge/timeline/calendar     same frontend via fetch
```

Three pieces:

- **collector/proxy.ts** — Bun, zero-dep. Transparent proxy. Logs `usage.jsonl`.
- **app/src-tauri/** — Rust. Reads JSONL → aggregates per-minute + per-day →
  exposes `snapshot(windowMinutes)` and `day_summaries(days)` Tauri commands.
- **app/src/** — vanilla JS + canvas frontend. Gauge, timeline, calendar, widget.
  Falls back to demo data when not under Tauri (so you can dev in a browser).

---

## 3. What EXISTS and what's VERIFIED

| Component                                                        | State       | Verified?                                                                                                            |
| ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `collector/proxy.ts`                                             | Complete    | ✅ tested end-to-end with a fake upstream — forwards body intact, logs tokens + 5h/7d utilization, never logs bodies |
| `app/src/` frontend                                              | Complete    | ✅ compiles (`bun build`); renders with demo data in browser                                                         |
| `app/src-tauri/src/lib.rs`                                       | Complete    | ⚠️ written, **NOT yet compiled** (`cargo`/`tauri build` not run — needs icons)                                       |
| `app/src-tauri/*.json, build.rs, main.rs`                        | Complete    | ⚠️ unbuilt                                                                                                           |
| docs (README, AGENTS, WEB_SHARING, ROADMAP, RATE_LIMITS, METHOD) | Complete    | ✅                                                                                                                   |
| icons                                                            | **MISSING** | ❌ must generate before `tauri build`                                                                                |

System tooling confirmed present: `cargo 1.94`, `cargo-tauri 2.11`, `webkit2gtk-4.1`, `bun`.

---

## 4. NEXT STEPS (do in this order)

### Step 1 — Make the desktop app actually build

```bash
cd ~/projects/claude-pulse/app
bun install                      # gets @tauri-apps/cli
# generate icons (Tauri needs them). Use any 512x512+ PNG:
cargo tauri icon path/to/logo.png    # OR drop placeholder PNGs in src-tauri/icons/
bun run build                    # or: bun run dev  (live window)
```

Expect possible Rust compile fixes in `lib.rs` (it's written but uncompiled). Likely
candidates: `dirs` crate version, serde derive on optional fields. Fix until it
compiles. The civil-date algorithm (`civil_from_days`) is dependency-free on purpose.

### Step 2 — Verify the full pipeline live

```bash
# terminal 1: collector
cd ~/projects/claude-pulse/collector && bun install && bun run start
# terminal 2: point a real tool at it + use Claude
export ANTHROPIC_BASE_URL=http://localhost:8787
qalcode    # or claude code; send a few messages
# terminal 3: confirm log is filling
tail -f ~/.local/share/claude-pulse/usage.jsonl
# then run the app (Step 1) and watch the gauge move
```

### Step 3 — Local web mode (the "view on phone / 2nd screen" feature)

Add a `--web` flag to `collector/proxy.ts` that ALSO:

- serves `app/src/` statically on :8788
- exposes `GET /api/snapshot?window=60` and `GET /api/days?days=35` returning the
  SAME shape as the Rust commands (port the aggregation logic from `lib.rs` to TS,
  or shell out — TS port is cleaner).
- The frontend `app.js` already falls back to `fetch` when Tauri is absent; wire
  `getSnapshot`/`getDays` to hit `/api/*` when served this way.
  This is Tier 1 of `docs/WEB_SHARING.md`. Still zero credentials, all local.

### Step 4 — Snapshot export + Cloudflare viewer (Tier 2)

- "Export Snapshot" button → writes an anonymized JSON (totals, peaks, rate-limit
  timings, daily history; NO prompts, NO token, NO account id).
- Static Cloudflare Pages site renders an uploaded snapshot client-side.
- See `docs/WEB_SHARING.md`. NEVER add credential upload.

### Step 5 — Polish

Model breakdown, configurable gauge max, desktop notification near limit,
observed-per-minute-limit estimator (cluster 429s → ceiling readout), system tray.

---

## 5. HARD RULES (never violate)

1. **No credential handling, ever.** No key/token collected, stored, sent, or asked for.
2. **Metadata only.** Never log prompt or completion text. Token counts, headers,
   status, timing only.
3. **No rate-limit brute-forcing / probing.** Discovery is passive observation of the
   user's own traffic only.
4. **Local-first.** No central server holding user data. No telemetry.
5. **Keep it lean:** collector zero-dependency (pure Bun); frontend framework-free
   (vanilla JS + canvas). Low barrier for OSS contributors.

## 6. Data schema (keep collector + Rust in sync, all fields optional on read)

`usage.jsonl`, one JSON object per line. Authoritative definitions:

- write side: `collector/proxy.ts` → `LogLine`
- read side: `app/src-tauri/src/lib.rs` → `RawLine`
  Key fields: `t` (epoch ms), `status`, `input`, `output`, `cacheRead`, `cacheWrite`,
  `rateLimited` (bool), `u5h`, `u7d` (0..1 utilization), `model`, `retryAfter`.

## 7. Testing without real tokens

Spin a fake upstream that returns a `usage` object + `anthropic-ratelimit-*` headers,
point `CLAUDE_PULSE_UPSTREAM` at it, hit the proxy with curl, check `usage.jsonl`.
(This is exactly how the collector was verified — see git history / README.)

## 8. Provenance

Born from qalcode2's in-TUI usage panel + reverse-engineering Anthropic's undocumented
OAuth rate-limit headers (`docs/RATE_LIMITS.md`). Part of the `~/projects/anthropic_pursuit/`
portfolio. Intended to be hosted as a project on qalarc.com.

## 9. Definition of done for v0.1 ship

- [ ] `tauri build` produces a working AppImage/.deb; gauge moves with real usage
- [ ] README quick-start works verbatim on a clean machine
- [ ] icons present; app has a name/icon in the launcher
- [ ] pushed to a public GitHub repo with MIT license (already MIT-licensed locally)
