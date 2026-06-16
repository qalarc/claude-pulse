# Anthropic Rate-Limit Response Headers — Reference

**Compiled:** 2026-05-30
**Why:** qalcode2's sidebar "Usage / Limits" panel needs to read live rate-limit
state. Anthropic returns TWO completely different header sets depending on auth
method (API key vs OAuth subscription). This document records both, with sources,
so the data is reusable by any tool (qalcode2, gmux, monitoring scripts, etc.).

---

## TL;DR: which set do I get?

| Auth method                                          | Header family                                                        | Usage model                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| **API key** (`x-api-key`)                            | `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-*` | Per-minute token-bucket (RPM / ITPM / OTPM) |
| **OAuth / Claude Pro·Max** (`Authorization: Bearer`) | `anthropic-ratelimit-unified-*`                                      | 5-hour rolling window + 7-day weekly window |

You (this machine) use **OAuth Max 20×** (`subscriptionType: max`,
`rateLimitTier: default_claude_max_20x`) → you get the **`unified`** set.

---

## Set A — API key path (official, documented)

Source: https://docs.anthropic.com/en/api/rate-limits (Response headers section).
These appear on every response; values reflect the MOST restrictive limit in effect.

| Header                                                             | Meaning                                   |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `retry-after`                                                      | Seconds to wait before retrying (on 429). |
| `anthropic-ratelimit-requests-limit`                               | Max requests per window.                  |
| `anthropic-ratelimit-requests-remaining`                           | Requests left before limited.             |
| `anthropic-ratelimit-requests-reset`                               | RFC-3339 time when requests replenish.    |
| `anthropic-ratelimit-tokens-limit`                                 | Max tokens per window.                    |
| `anthropic-ratelimit-tokens-remaining`                             | Tokens left (rounded to nearest 1k).      |
| `anthropic-ratelimit-tokens-reset`                                 | RFC-3339 time tokens replenish.           |
| `anthropic-ratelimit-input-tokens-{limit,remaining,reset}`         | Input-token (ITPM) variant.               |
| `anthropic-ratelimit-output-tokens-{limit,remaining,reset}`        | Output-token (OTPM) variant.              |
| `anthropic-priority-{input,output}-tokens-{limit,remaining,reset}` | Priority Tier only.                       |
| `anthropic-fast-*`                                                 | Fast mode (research preview) only.        |

Key API-key facts:

- Rate limits are **per usage tier** (Tier 1–4), set at org level.
- Limits are **per model class** — Opus, Sonnet 4.x, Haiku, Fable 5 each separate.
  (Opus limit is shared across Opus 4.8/4.7/4.6/4.5/4.1.)
- Token bucket = continuously replenished, not reset at fixed intervals.
- **Cached input tokens (`cache_read_input_tokens`) do NOT count toward ITPM**
  for most models (Haiku 3.5 is the exception). So caching raises effective TPM.

---

## Set B — OAuth / Claude Pro·Max subscription path (UNDOCUMENTED)

These are **not in the public docs**. They are reverse-engineered from Anthropic's
own shipped Claude Code source + live captures. They appear on EVERY response
(not just 429s). Subscription usage is expressed as **utilization fractions
(0.0–1.0)**, NOT a remaining count.

| Header                                                    | Type / values                                                        | Meaning                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `anthropic-ratelimit-unified-status`                      | `allowed` \| `allowed_warning` \| `rejected`                         | Overall gate for this request. `rejected` ⇒ 429.                            |
| `anthropic-ratelimit-unified-reset`                       | unix epoch **seconds**                                               | Reset of the _representative_ (binding) window.                             |
| `anthropic-ratelimit-unified-representative-claim`        | `five_hour` \| `seven_day` \| `seven_day_opus` \| `seven_day_sonnet` | **Which window is currently binding** — the one Claude Code's UI bar shows. |
| `anthropic-ratelimit-unified-5h-utilization`              | float 0.0–1.0                                                        | Fraction of the 5-hour rolling session window used (`0.26` = 26%).          |
| `anthropic-ratelimit-unified-5h-reset`                    | unix epoch seconds                                                   | When the 5h window resets.                                                  |
| `anthropic-ratelimit-unified-5h-surpassed-threshold`      | float                                                                | Early-warning threshold crossed (present near limit).                       |
| `anthropic-ratelimit-unified-7d-utilization`              | float 0.0–1.0                                                        | Fraction of the 7-day (weekly) window used.                                 |
| `anthropic-ratelimit-unified-7d-reset`                    | unix epoch seconds                                                   | When the weekly window resets.                                              |
| `anthropic-ratelimit-unified-7d-surpassed-threshold`      | float                                                                | Weekly early-warning threshold crossed.                                     |
| `anthropic-ratelimit-unified-fallback`                    | `available` (only value seen)                                        | Whether a fallback (e.g. Sonnet) path is available.                         |
| `anthropic-ratelimit-unified-fallback-percentage`         | float (observed const `0.5`)                                         | Capacity-allocation ratio for fallback.                                     |
| `anthropic-ratelimit-unified-overage-status`              | `allowed` \| `allowed_warning` \| `rejected`                         | State of paid extra-usage billing.                                          |
| `anthropic-ratelimit-unified-overage-reset`               | unix epoch seconds                                                   | When overage budget resets (monthly).                                       |
| `anthropic-ratelimit-unified-overage-utilization`         | float 0.0–1.0                                                        | Fraction of overage budget consumed.                                        |
| `anthropic-ratelimit-unified-overage-surpassed-threshold` | float                                                                | Overage early-warning threshold.                                            |
| `anthropic-ratelimit-unified-overage-disabled-reason`     | enum (below)                                                         | Why overage is unavailable.                                                 |
| `retry-after`                                             | seconds                                                              | Sent on `rejected` when no overage available.                               |

`overage-disabled-reason` observed enum:
`out_of_credits`, `org_level_disabled`, `org_level_disabled_until`,
`org_service_zero_credit_limit`, `member_zero_credit_limit`,
`seat_tier_zero_credit_limit`.

### How to display "X% used, resets at HH:MM" (what ccusage / claude-monitor do)

1. Read `unified-representative-claim` → pick which window is binding.
2. Read that window's `-utilization` (×100 = %) and `-reset` (epoch → local HH:MM).
3. `unified-status === "allowed_warning"` ⇒ show amber; `"rejected"` ⇒ red + retry-after.

### Live capture from THIS machine (Max 20×, 2026-04-14)

From `docs/issues/AUTH_ISSUES_2026-04-14.md` — a successful Haiku request returned:

```
anthropic-ratelimit-unified-status: allowed
anthropic-ratelimit-unified-5h-utilization: 0.03
anthropic-ratelimit-unified-7d-utilization: 0.12
anthropic-ratelimit-unified-overage-status: rejected
anthropic-ratelimit-unified-overage-disabled-reason: org_level_disabled
```

Interpretation: 3% of the 5h window and 12% of the weekly window used; overage
(paid extra usage) disabled at the org level. Sonnet/Opus 429s on this account
are model-tier-specific, separate from the unified % (which was only 3%).

---

## Sources (ranked by reliability)

1. **Anthropic's own shipped Claude Code source (de-minified)** — the literal
   TypeScript type definitions Anthropic ships:
   - `WuMingDao/claude-code-v-2.1.88` → `package/src-extracted/src/services/mockRateLimits.ts`
     (full `MockHeaders` type with all literal-union values)
   - `apstenku123/claude-code-reverse` → `extractUnifiedRateLimitInfo.js` (the real parser)
2. **48-hour live proxy capture on a Max 20× account** (37,363 requests):
   - `ArkNill/claude-code-hidden-problem-analysis` → `02_RATELIMIT-HEADERS.md`
3. **Independent third-party parser** mirroring Claude Code:
   - `okhsunrog/claude-proxy-rs` → `src/usage/headers.rs`
4. **Local capture** — `docs/issues/AUTH_ISSUES_2026-04-14.md` (matches 1–3 exactly).
5. **Official API-key docs** — https://docs.anthropic.com/en/api/rate-limits (Set A only).

No conflicts across sources for Set B. Only minor uncertainty: `unified-fallback`
has only ever been seen as `available`, and `-fallback-percentage` only as `0.5`.

---

## Implementation notes for qalcode2

- Capture happens in `packages/opencode/src/provider/provider.ts` (fetch wrapper)
  → `packages/opencode/src/provider/ratelimit.ts` (`RateLimit.record`).
- **The 5h-utilization / 5h-reset pair is the headline number** for subscription
  users — that's the "you've used X% of your current session, resets in Yh" bar.
- For API-key users, fall back to `tokens-remaining` / `tokens-limit`.
- Plan label ("Max 20×") comes from `~/.claude/.credentials.json`
  `claudeAiOauth.rateLimitTier` (`default_claude_max_20x`) + `subscriptionType`.

## Caveat / ethics note

These `unified-*` headers are undocumented and reverse-engineered. They can change
without notice. They are returned to the client on responses to that client's own
account — reading your own rate-limit state is legitimate. Do not use this to probe
other accounts or circumvent limits.
