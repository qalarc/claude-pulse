# qalarc.com — Projects

Human-readable index of qalarc.com projects. Machine-readable source: `projects.json`.

---

## ⭐ Claude Pulse — _featured, active, open source (MIT)_

**Open-source Claude API usage monitor with an accelerometer-style live gauge.**

A local-first desktop app that visualizes Anthropic Claude API usage in real time:

- **Accelerometer gauge** — tokens-per-minute as a sweeping needle (green → amber → red), with a peak marker
- **Per-minute timeline** — input/output tokens + requests, with peak and rate-limit (429) markers
- **Calendar** — daily usage, peaks, and throttle counts
- **Widget mode** — always-on-top mini-gauge for a second monitor

Works with **any** Claude tool (Claude Code, qalcode2, scripts) by capturing usage
at the network layer through a tiny local proxy that logs **metadata only** — never
prompts, never credentials. Helps users find their **undocumented per-minute rate
limit** by observing their own traffic (no probing/brute-forcing).

- **Repo:** `~/projects/claude-pulse`
- **Start here:** `CONTINUATION.md` (full build/continue guide), `README.md`
- **Stack:** Tauri 2 (Rust) + Bun proxy + vanilla-JS/canvas frontend
- **Privacy:** metadata only; credentials never leave the user's machine
- **Page:** https://qalarc.com/projects/claude-pulse
- **GitHub:** https://github.com/fivelidz/claude-pulse

---

## Claude Rate-Limit Monitor — _research / reference_

The research notes behind Claude Pulse: the three rate-limit layers (per-minute /
5-hour / 7-day), the undocumented OAuth `unified-*` header set, and the
observe-don't-brute-force methodology. Superseded as a product by Claude Pulse.

- **Path:** `~/projects/qalarc.com/projects/claude-ratelimit-monitor`

---

## How to add a project to qalarc.com

1. Add an entry to `projects.json` (the site renders this).
2. Add a section here in `PROJECTS.md`.
3. Put project files under `projects/<slug>/` or link an external repo path.
4. When the qalarc.com site is built, it should fetch `projects.json` and render
   cards; featured projects appear first.
