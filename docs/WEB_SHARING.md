# Web sharing — the safe design

This documents how Claude Pulse can offer a "view/share my stats online" experience
(including via Cloudflare) **without ever handling user credentials.**

## The request

"A public web page (e.g. on Cloudflare) where people put in their Claude details and
it shows/shares their statistics, running locally on their system."

## The hard constraint

**A user's Anthropic API key or OAuth token must NEVER leave their machine and must
NEVER be entered into a third-party web form.** Asking for it is a credential-harvesting
pattern — even with good intentions, it trains users into unsafe behavior and creates a
liability. We will not build that. (This is non-negotiable; see AGENTS.md hard rules.)

Important nuance: you don't NEED the credential to show usage stats. Claude Pulse gets
all its data from the **local proxy log** (`usage.jsonl`), which is produced by the
user's own traffic. The credential only ever touches the user's own collector, which
just forwards it to Anthropic untouched. So the web layer never needs it.

## Three safe tiers

### Tier 1 — Local web mode (recommended default)

The collector serves the same dashboard as a local web page:

```
bun run start --web        # serves dashboard at http://localhost:8788
```

- Reads the local `usage.jsonl`; exposes `/api/snapshot` and `/api/days` JSON.
- The existing `app/src/` frontend works unchanged (it already falls back to `fetch`
  when Tauri isn't present — point it at these endpoints).
- View it from your phone/tablet on the **same LAN** (`http://<your-ip>:8788`).
- **Nothing leaves your machine.** No cloud, no credentials, no account.

### Tier 2 — Snapshot sharing (the safe "public page")

For sharing with others / posting publicly:

1. User clicks **Export Snapshot** in the app.
2. Produces an **anonymized** file: totals, per-minute peaks, rate-limit timings,
   daily history. **No prompts, no completions, no token, no account id.**
3. A **static Cloudflare Pages site** (`pulse.qalarc.com`, say) lets anyone **upload
   that snapshot file** and renders the same charts in-browser. The snapshot is parsed
   client-side; it can be 100% static (no server, no database, no secrets).
   - Optionally: "publish" creates a shareable read-only link backed by an R2 object the
     user explicitly uploaded. Still no credentials — just the stats file they chose.

This gives you the Cloudflare-hosted shareable page you wanted, with zero credential risk.

### Tier 3 — Self-hosted sync (advanced, opt-in)

Power users can point the collector at _their own_ endpoint to push snapshots to a
server they control. We never operate a central server that holds anyone's data.

## What a Cloudflare deployment looks like

- **Cloudflare Pages**: hosts the static `app/src/` frontend in "snapshot viewer" mode.
- **Optional Cloudflare R2**: stores user-uploaded snapshot files for shareable links.
- **Optional Cloudflare Worker**: issues short-lived signed upload URLs (so the static
  site can store a snapshot) — handles snapshot files only, never credentials.
- **No Worker ever receives an API key.** If a future contributor proposes one that
  does, reject it.

## Summary

| Want                             | How                                        | Credential leaves machine? |
| -------------------------------- | ------------------------------------------ | -------------------------- |
| View on 2nd screen / phone       | Tier 1 local web mode                      | No                         |
| Share stats publicly             | Tier 2 snapshot upload to Cloudflare Pages | No                         |
| Sync to my own server            | Tier 3 opt-in self-host                    | No (your server)           |
| "Enter your API key on our site" | ❌ never built                             | —                          |
