# Claude By-Minute Rate Limit Monitoring

A qalarc.com project: real-time, by-minute monitoring of Claude API usage and
rate limits — built into qalcode2, designed to be reusable across tools.

## The problem it solves

If you run agents on Claude (especially several at once on a **Max/Pro OAuth
subscription**), you hit a **per-minute / short-window rate limit** that:

- Is **not published** for the OAuth/subscription path
- Is **not a single header** you can read
- Trips **instantly** when multiple clients share one subscription token
- Is separate from the 5-hour and 7-day rolling windows

This project surfaces all of it live so you can see _why_ you got limited and at
_what throughput_ it happened — without ever probing/attacking the API.

## The three limit layers on a Max account

| Layer                                            | Window                       | How we observe it                                             |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| **Short-window** (per-minute / per-second burst) | ~60s, undocumented for OAuth | **Measured locally** + **learned from observed 429s**         |
| **5-hour session window**                        | 5h rolling                   | Read from `anthropic-ratelimit-unified-5h-utilization` header |
| **7-day weekly window**                          | 7d rolling                   | Read from `anthropic-ratelimit-unified-7d-utilization` header |

## What the monitor shows (qalcode2 sidebar → "Usage / Limits")

**Per minute (measured locally, all sessions, rolling 60s):**

- TPM — combined tokens/min
- ITPM — input tokens/min (uncached input + cache-writes; cache-reads excluded)
- OTPM — output tokens/min
- RPM — requests/min
- Rate — tokens/sec (10s avg)

**Observed limit (LEARNED, not probed):**

- The lowest per-minute throughput at which a 429 was seen during normal use.
  After a few natural hits this is your effective short-window ceiling.
- e.g. "≈ 7 req/min before 429", "≈ 40K in-tok/min before 429"

**Anthropic-reported (from response headers):**

- 5h window %, 7d window %, which window is binding, reset countdowns
- Plan label (e.g. "Max 20×")
- warning / rejected status, retry-after

## The method: observe, don't brute-force

We do NOT send escalating bursts to find the limit. That risks flagging a
third-party-OAuth account and burns the rolling windows for no benefit.

Instead we **learn passively**: the client already makes requests during normal
use; when a 429 fires, we record the per-minute throughput measured in that
moment. The minimum across observed hits ≈ the real ceiling. Same knowledge,
zero added risk, and a more honest number (it reflects real burst/acceleration
behavior, not a synthetic probe).

See `METHOD.md` for the full rationale and `FINDINGS.md` for what's known.

## Status

- ✅ Implemented in qalcode2 (`provider/ratelimit.ts` + sidebar panel)
- ✅ Observed-ceiling learning + disk persistence
- ⬜ Standalone `claude-usage` CLI (extract from qalcode2)
- ⬜ qalarc.com page / public writeup
