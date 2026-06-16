# Findings — Claude rate limits in practice

## The "rate limited immediately" diagnosis (2026-06-16)

Symptom: hitting the per-minute rate limit instantly, even at low 5h-window usage.

Root cause found via `ss -tnp` + `ps`: **5 concurrent qalcode2 sessions** were
all running against the **same Max OAuth token** simultaneously:

| PID     | Project                    | Started |
| ------- | -------------------------- | ------- |
| 9319    | 4chan_scrape_data_analysis | 03:29   |
| 13439   | unity_projects/robot_arms  | 03:30   |
| 59006   | AI_diary                   | 03:46   |
| 139161  | qalcode2                   | 04:08   |
| 1789182 | QTK                        | 13:07   |

All held live connections to `160.79.104.10:443` = **AS399358 Anthropic, PBC**.

**Conclusion:** The Max subscription's short-window limit is sized for ONE Claude
Code client. Fanning it across 5 qalcode2 instances multiplies the request rate
~5×, tripping the per-minute/acceleration limit whenever 2-3 fire in the same
minute. This is an architecture issue (token fan-out), not an unknown limit.

### Fixes (in order of effectiveness)

1. Run fewer concurrent OAuth sessions (1-2, not 5).
2. Give heavy/parallel agents their own **API key** (separate published limits).
3. Route concurrent agents to **local models** (Ollama yolo-local-\*) — no Anthropic
   traffic at all.
4. Stagger request timing across sessions.

## What we know about the limits themselves

### API-key path (documented)

Per-minute RPM / ITPM / OTPM by tier, per model class. Published tables:
docs.anthropic.com/en/api/rate-limits. Cache-reads excluded from ITPM (most models).

### OAuth / Max path (undocumented)

- No per-minute ceiling sent to client. Only 5h + 7d window utilization (headers).
- A short-window/acceleration limit exists and bites bursty multi-client use,
  but its exact number is not exposed.
- Our **observed-ceiling tracker** learns it from real 429s (see METHOD.md).

### Confirmed header set (OAuth/Max)

`anthropic-ratelimit-unified-status` (allowed/allowed_warning/rejected),
`-representative-claim`, `-5h-utilization`, `-5h-reset`, `-7d-utilization`,
`-7d-reset`, `-overage-*`. Full reference:
`~/projects/github_repos/qalcode2/docs/ANTHROPIC_RATELIMIT_HEADERS.md`.

## Live capture (Max 20×, prior)

```
unified-status: allowed
unified-5h-utilization: 0.03   (3%)
unified-7d-utilization: 0.12   (12%)
unified-overage-status: rejected
unified-overage-disabled-reason: org_level_disabled
```

Note: 3% of the 5h window yet still 429'd on Sonnet/Opus — strong evidence the
immediate limit is the short-window/concurrency effect, NOT the rolling window.
