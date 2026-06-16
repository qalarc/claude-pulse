# Roadmap

## v0.1 (now)

- [x] Collector proxy (token + rate-limit + 429 logging, no bodies)
- [x] Tauri app: accelerometer gauge, per-minute timeline, calendar, widget mode
- [x] Browser demo-data fallback
- [ ] Build/ship: generate icons, verify `tauri build` on Linux + macOS + Windows

## v0.2

- [ ] Local web mode (`--web`): serve dashboard + JSON API from the collector (Tier 1
      of WEB_SHARING.md) — view on phone/2nd screen, nothing leaves the machine
- [ ] Snapshot export (anonymized stats JSON + PNG)
- [ ] Model breakdown (per-model TPM/usage)
- [ ] Configurable gauge max + alert thresholds (desktop notification near limit)

## v0.3

- [ ] Cloudflare Pages snapshot viewer (Tier 2): upload an exported snapshot, render
      charts client-side. Static, no credentials, no server secrets.
- [ ] Optional R2-backed shareable links (user-uploaded snapshots only)
- [ ] Observed per-minute limit estimator (cluster 429s → effective ceiling readout)

## Later

- [ ] System tray with mini-gauge
- [ ] Multi-account / multi-key separation
- [ ] Import Claude Code's own `~/.claude/projects/**/*.jsonl` as an additional source
      (so usage is captured even without routing through the proxy)

## Non-goals (will not build)

- Any feature that collects a user's API key / OAuth token on a remote server
- Any rate-limit probing / brute-forcing
- Logging prompt or completion content
