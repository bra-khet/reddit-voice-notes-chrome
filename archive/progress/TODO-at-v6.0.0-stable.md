> **Archive provenance:** Full task snapshot captured after the v6.0.0 stable checkpoint — 2026-07-23.
> Original path: `TODO.md`. Superseded by the post-v6 open-work register at that path.

# TODO

## Current stable — **v6.0.0 Polish & Visual Maturity** (tagged `v6.0.0` · 2026-07-23 · push user-owned)

**Package:** `6.0.0` · **Tag:** `v6.0.0` · **Release notes:** [`docs/release-notes-v6.0.0.md`](docs/release-notes-v6.0.0.md) (full detail + **GitHub release summary** at top)

Four tracks + Field Guide orientation, one stable product checkpoint:

| Track | Focus | Status |
|-------|-------|--------|
| **A** | Audio-reactive visuals · Style Control Center · governor | Confidence QA PASS · shipped |
| **B** | Background Layout v2 · direct manipulation · presets/effects | Full operator checklist PASS · shipped |
| **C** | Popup Cividis refresh · restart caution | Agent gate PASS · shipped |
| **D** | Hosted Design Studio on GitHub Pages | Phases 0–4 · real Pages 5.7 PASS · shipped |
| **Guide** | Field Guide + hub orientation | Single tutorial source · shipped |

**Hosted:** https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/  
**Prior:** v5.11.0 prefs IDB · notes archived [`archive/docs/release-notes-v5.11.0.md`](archive/docs/release-notes-v5.11.0.md)

### Post-ship (optional — not blockers)

- Track C §8 real-extension popup appearance eyeball
- Conway Life long-horizon corner parking residual
- Preference Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md))
- Free-form style composition / arbitrary stackables (v6.1+ candidate)

**Non-negotiables that remain:** capture-time visuals; Design-phase bg layout only (I1/I3); `normalize*` guards / no casual `USER_PREFS_VERSION` bump; host-neutrality gates Pages; `npm run compile` zero-error.

**Push of `main` + tag remains user-owned.**

## Hardening closed (pre-v6 — no separate version bump)

| Item | Outcome |
|------|---------|
| **H13** persist-before-stamp | RESOLVED + browser QA PASS |
| **H14 / BUG-038** tab-close transcript | RESOLVED + browser QA PASS |
| **H8** recovery voice provenance | RESOLVED + browser QA PASS |

## Shipped ledger

Full milestone index: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | Notes |
|---------|-------|-------|
| **v6.0.0** | Polish & Visual Maturity (A/B/C/D + Field Guide) | [notes](docs/release-notes-v6.0.0.md) |
| **v5.11.0** | Preferences full-IDB migration | [notes](archive/docs/release-notes-v5.11.0.md) |
| **v5.10.0** | Raw WebM trim — post-trim voice re-apply | [notes](archive/docs/release-notes-v5.10.0.md) |
| **v5.9.0** | Atomic trim apply | [notes](archive/docs/release-notes-v5.9.0.md) |
| **v5.8.0** | Timeline visual subtitle editor | [notes](archive/docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (default-on) | [notes](archive/docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply | [notes](archive/docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout v6.0.0 && npm install && npm run dev`

## Architecture hardening

**v6.0.0 shipped** — map **v3.26** · extension-points **v1.42** · hardening backlog **v2.13** · ADRs 0001–0010. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
