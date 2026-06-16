# Method: observe, don't brute-force

## Why not brute-force?

Brute-forcing = sending escalating request bursts _with the intent to trigger_
rate-limit errors, to map the boundary. It would reveal the undocumented
short-window limit — but:

1. On a **third-party-OAuth Max token** (already policed by Anthropic), a
   deliberate burst-to-failure pattern is exactly what abuse/acceleration
   detection flags → real risk of account suspension.
2. It burns the 5h/7d rolling windows for no productive work.
3. It produces a _synthetic_ number that may differ from how the limit behaves
   under real workloads (the acceleration limiter reacts to traffic _shape_).

Discovering undocumented behavior is fine — and valuable. The objection is purely
about **method**: provoke vs observe. We choose observe.

## The passive-learning approach

The client already makes real requests during normal use. We instrument it to:

1. **Continuously measure** per-minute throughput (RPM, ITPM, OTPM, TPM) across
   all sessions, in a rolling 60s window — by diffing each assistant message's
   cumulative token counts (no extra API calls; pure local accounting).
2. **Detect a 429 / rejection** by reading `anthropic-ratelimit-unified-status ==
"rejected"`, a `retry-after` header, or HTTP 429 on responses that were going
   to happen anyway.
3. **Record the throughput at the moment of rejection.** Debounced to once per
   10s so one 429 burst doesn't over-count.
4. **Keep the minimum** observed-at-rejection value across hits → the tightest
   empirical bound on the ceiling. Persist to disk so it survives restarts.

After a handful of _naturally occurring_ rate-limit hits, you have an
empirically-characterized short-window limit — obtained with **zero** added API
traffic and **zero** account risk.

## Why this is the better artifact

"I instrumented my client to empirically characterize Claude's undocumented
short-window rate limits from observed 429s during normal use" is:

- Technically interesting (passive measurement, header archaeology)
- Ethically clean (own account, no probing, no circumvention)
- More accurate (reflects real burst/acceleration behavior)
- A genuine portfolio piece for developer-tooling / DevRel work

vs. "I ran a limit-probing attack against the API on a spoofed subscription
token" — same number, but the wrong story.

## Implementation pointers (qalcode2)

- Measurement + learning: `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`
  (`recordTokens`, `noteRejection`, persisted to `<data>/ratelimit-observed.json`)
- Header capture: `packages/opencode/src/provider/ratelimit.ts`
- The same logic is portable to a standalone `claude-usage` CLI.
