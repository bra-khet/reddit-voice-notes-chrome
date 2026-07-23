# Release notes — v6.0.0 **Polish & Visual Maturity**

**Tag:** `v6.0.0` · **Date:** 2026-07-23  
**Prior stable:** `v5.11.0` (Preferences full-IDB migration)  
**Codename:** Polish & Visual Maturity  
**Tracks:** A audio-reactive visuals · B background layout · C popup refresh · D hosted Design Studio  
**Restore:** `git checkout v6.0.0 && npm install && npm run dev`  
**Hosted Studio:** https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/  
**Orientation hub:** https://bra-khet.github.io/reddit-voice-notes-chrome/  

---

## GitHub release summary

*Copy everything below this line into the GitHub Release body. The full technical notes follow further down.*

---

### Reddit Voice Notes **v6.0.0** — Polish & Visual Maturity

**Record. Style. Caption. Bake. Download.** All in your browser — install optional.

v6 is a **stable product checkpoint**: a mature Design Studio you can use without installing anything, a far richer visual system, tactile background framing, and a refreshed Field Guide that matches how the product actually works today.

#### Try it now (no install)

| Surface | What it is |
|---------|------------|
| **[Design Studio](https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/)** | Full product on GitHub Pages — record, style, caption, edit, bake, download |
| **[Orientation hub](https://bra-khet.github.io/reddit-voice-notes-chrome/)** | Start here — Design → Capture → Polish |
| **[Field Guide](https://bra-khet.github.io/reddit-voice-notes-chrome/tutorial/)** | Interactive walkthrough of the real workflow |
| **[Voice Lab](https://bra-khet.github.io/reddit-voice-notes-chrome/studio/)** | Lightweight voice audition & transfer |

The Chrome extension remains the path for **quick in-thread capture** and optional **Attach to Reddit**. Reddit is never a recording prerequisite.

---

#### What’s new in v6

**Hosted Design Studio**  
The complete Studio runs as a static site: live WYSIWYG capture, take deck, voice, captions (Vosk), timeline editor, browser-composite bake, and download. First visit warms local media engines; later visits reuse a durable cache. Extension install is optional.

**Audio-reactive visual system**  
Six spectrum looks, seven atmospheres, seven ordered accents (stackables), unified Style Control Center, High Contrast / reduced-motion care, caption-safe dim, and a visible performance governor tied to real bake-size budgets.

**Background Layout v2**  
Drag, zoom, and fine-position personal images on the hero preview. Presets, dim/blur/blends, solid plates, Holo, GIF controls, eye-dropper, framing aids, keyboard/ARIA, and session-only A/B layout. What you arrange is what the *next* recording captures.

**Popup & orientation polish**  
Extension popup on the shared Cividis indigo→amber system with an elevated reload caution. Field Guide and hub teach **Design → Capture → Polish & Bake** for hosted Studio *and* extension.

---

#### The product at a glance (stable checkpoint)

Everything that already worked through v5.11 still does — this release is additive polish and delivery, not a rewrite of the core suite.

| You can… | How |
|----------|-----|
| Design look & voice | Profiles, custom styles, Dulcet II character voices, Style Control Center |
| Record with live preview | Studio-native capture *or* Reddit injector — WYSIWYG canvas = encoded pixels |
| Keep a take across reloads | Take lifecycle + crash-safe artifact stamps |
| Caption automatically | On-device Vosk → editable cues → burn-in |
| Edit timing & trim | Visual subtitle timeline; reversible trim intent; atomic Apply trim that keeps voice re-apply |
| Change voice after the fact | Audio-decoupled re-apply / Change Voice (including post-trim when raw audio survives) |
| Bake fast | Browser-composite default; partial re-bake splice for cue edits |
| Export | Download MP4 always; optional Attach to Reddit from the extension |
| Prefer private | All processing client-side until *you* share the file |
| Prefer no install | Full hosted Studio on Pages |

**Privacy:** recording, visualization, transcription, voice DSP, and bake stay on your machine.

---

#### Upgrade notes

- **No preference schema bump.** Existing profiles, styles, backgrounds, and settings load as before; new visual fields default sensibly.
- **Extension users:** reload the extension after install/update (`chrome://extensions` → Reload, or the popup **Reload** control when shown).
- **Hosted users:** hard-refresh if an old Pages build is cached; the first load may download ~31 MB of local FFmpeg core (then cached).
- **Manifest / package:** `6.0.0`.

---

#### Known residuals (non-blocking)

- Conway Life can park in a dead-edge corner after a very long run while other colonies remain active.
- Optional real-device popup appearance eyeball remains cosmetic.
- Preference Import is full-replace (merge/union mode is future work).

---

#### Links

- Full release notes (this file, complete technical detail): [`docs/release-notes-v6.0.0.md`](https://github.com/bra-khet/reddit-voice-notes-chrome/blob/main/docs/release-notes-v6.0.0.md)
- Milestone index: [`docs/HISTORY.md`](https://github.com/bra-khet/reddit-voice-notes-chrome/blob/main/docs/HISTORY.md)
- Architecture: [`docs/architecture/`](https://github.com/bra-khet/reddit-voice-notes-chrome/tree/main/docs/architecture)

---

*End of GitHub release summary — full notes continue below.*

---

## Headline

> **v6 makes the Design Studio a complete, public product — and makes it beautiful.**  
> Four development tracks ship together: a generalized audio-reactive visual system, direct-manipulation background layout, a Cividis popup refresh, and the **full Design Studio on GitHub Pages** so anyone can author a voice note without installing an extension. The Field Guide and orientation hub now teach the real mental model: **Design → Capture → Polish & Bake**, with Reddit as an optional publish path. Core contracts from v5.4–v5.11 (take lifecycle, browser composite, audio decoupling, timeline trim, IDB prefs) are unchanged and remain the stable foundation.

---

## What shipped

### Track D — Hosted Design Studio (delivery surface)

The complete Design Studio is available as a **static GitHub Pages site** that compiles the **same** `src/` Studio the extension uses, under a thin web host adapter:

- **One `browser` global shim** (storage over Pages-origin IDB, loopback `runtime` bus, `getURL` prefix) — not a second Studio implementation.
- **Record + browser-composite bake** were already host-neutral; **transcode / fallback burn-in / transcribe** reuse the real offscreen pipeline **in-page** over a loopback bus (shared validators, cancel, progress contract).
- **Vosk captions** vendored for the demo; terminal transcript persistence matches extension behavior so auto-captions appear in the Studio UI.
- **Chronos gate** pre-warms FFmpeg before the Studio mounts (correctness: bake ACK budgets include WASM cold start). Failure policy: **Retry** or **Open anyway** with an adjacent warning — never a hard trap, never silent.
- **Cache Storage** durable warm copy of the 31 MB core wasm so warmed bakes survive HTTP-cache eviction.
- **Host-neutrality CI gate** (`npm run test:host-neutrality`) is the first step of the demo build and blocks bad Pages deploys.
- **Naming:** lightweight Pages page is **Voice Lab**; “Design Studio” means the full product. User-facing copy no longer presents Reddit as a recording *requirement* (provenance, optional attach, real constraints, and the product name remain).

**Canonical design:** [`v6.0.0-hosted-design-studio.md`](v6.0.0-hosted-design-studio.md) · **QA:** [`qa/QA-6.0.0/track-d/`](../qa/QA-6.0.0/track-d/) (real Pages 5.7 operator PASS 2026-07-23).

### Track A — Audio-reactive visuals + Style Control Center

Replaces ad-hoc bars and two hard-coded overlays with a registry-driven system painted at **record time** into the capture canvas (preview = next recording; bake does not re-draw bars/effects):

| Layer | Catalog |
|-------|---------|
| **Spectra (6)** | Oscilloscope · Minimal · Classic (Neon Glow) · Phosphor · Radial Spectrum · Central Pulse |
| **Atmospheres (7)** | Forest Spirits · Digital Rain · Inferno (+ Void Inferno treatment) · Aurora · Glitch · Sparkle · Bubbles (`bokeh` ID stable) · Clean |
| **Stackables (7, max 3)** | Rising Ember · Electric Arc · Lightning · Conway Life · Layered Smoke · Neon Glow · Particle Burst |

- **Style Control Center** — spectrum / atmosphere / accent discovery, shared tuning, band weights, contextual layout & readability, High Contrast, afterimage where declared.
- **Performance governor** — Comfortable / Elevated / Guarded estimates; Guarded can suspend the costliest accent at record time without rewriting the saved list.
- **Caption-safe dim** after visual layers, below captions.
- **Cividis token system** shared across Studio, popup, and guides.
- **Accepted residual:** Conway can park in a dead-edge corner after a long run.

**Canonical design:** [`v6.0.0-custom-styles-refactor.md`](v6.0.0-custom-styles-refactor.md) · ADRs [0007](architecture/adr/0007-audio-reactive-visualizer-core.md), [0009](architecture/adr/0009-registry-native-sparkle-bokeh.md), [0010](architecture/adr/0010-bubbles-label-stable-bokeh-id.md).

### Track B — Background Layout v2

Design-phase direct manipulation of personal backgrounds (still **I1/I3**: layout is captured at record time; you cannot re-position an already-recorded take):

- Hero **drag / zoom** writing normalized `customPosition` + `manualScale`.
- **Precision console** (bidirectional mini-map, nudges, Center reset in the precision stage).
- **Presets**, **dim** as a real field, **blur**, **blend modes** + blend plates, **Holo**, **GIF** speed / audio-reactivity, **eye-dropper**.
- **Framing aids** (crop guides, thirds — not multi-aspect export; pipeline remains 16:9).
- Live **Theme-only compare**, session-only **next-take A/B**, keyboard/ARIA, High Contrast / reduced motion.
- Migration-compatible: discrete `position` / `scaleMode` still normalize and emit.
- Size gate: blur+GIF **23 / 29 MiB** PASS against 25 / 30 MiB caps.

**Canonical design:** [`v6.0.0-background-panel-refactor.md`](v6.0.0-background-panel-refactor.md) · [ADR-0008](architecture/adr/0008-background-direct-manipulation-layout.md) · QA checklist PASS.

### Track C — Popup UI refresh

- Popup-only **Cividis** palette (`popup-palette.css`) — no Studio leakage (shared base `style.css` left intact for Studio primitives).
- Amber “on” toggles, amber-action **Open Design Studio** CTA, elevated **restart caution** bar with inline **Reload now**.
- Agent visual gate PASS; optional real-extension eyeball remains non-blocking.

**Canonical design:** [`v6.0.0-popup-ui-refresh.md`](v6.0.0-popup-ui-refresh.md).

### Field Guide & orientation (pre-ship polish)

- **Single source of truth:** [`demo/public/tutorial/index.html`](../demo/public/tutorial/index.html); [`docs/tutorial/README.md`](tutorial/README.md) is the governance pointer (duplicate docs HTML removed).
- Teaches **hosted Studio + extension + optional Reddit attach**, progressive disclosure of Current Take deck, Style Control Center, background layout, timeline, trim vs Apply, voice re-apply, bake/download.
- Product-native tutorial chrome: sticky phase chip, progress persistence, accessible routes, reduced-motion, Cividis tokens.
- Hub / README / Voice Lab copy aligned; entry plates reuse v4 double-enter chevrons.

---

## Product checkpoint — what you already have (v5.4 → v5.11)

v6 deliberately does **not** re-open these contracts. New users should treat this as the current complete suite:

### Authoring & session (v5.4+)
- **Design Studio First** — record, re-record, preview, caption, bake, download in one place; Reddit is attach/publish, not a forced capture venue.
- **Take lifecycle** (`rvn.take.current`) with cross-context sync, auto-draft, recovery, discard-restore.
- **H6 artifact stamps** — recovery / download / attach never silently adopt the wrong blob.
- **Live WYSIWYG capture** — the recorder canvas *is* the encoded pixels; restyle mid-take.

### Bake & composite (v5.5+)
- **Browser-side full composite** (mediabunny) default-on since v5.5.1 — eliminates the FFmpeg alphamerge wall for the flagship path.
- Fallback chain preserved for capability gaps.

### Voice & audio (v5.0 / v5.6 / v5.10)
- **Dulcet II** graph-native voice DSP (character presets, intensity, Turbo, Fine-tune).
- **Audio decoupling** — voice re-apply / Change Voice without re-recording visuals (bit-exact visual remux).
- **Raw trim apply (v5.10)** — Apply trim cuts raw WebM + base MP4 atomically so post-trim voice still works; honest demotion if the raw leg can’t run.

### Subtitles & editing (v4 → v5.9)
- **Vosk** on-device STT; segment editor; Smart Split / Smart Adjust.
- **Visual subtitle timeline (v5.8)** — cue bars, waveform, snap, keyboard, undo, multi-select, smart suggestions, non-destructive trim *intent*.
- **Atomic Apply trim (v5.9)** — materializes shorter base, cue shift, re-stamp; partial re-bake splice (v5.7) for cue-only edits.

### Preferences & storage (v5.11)
- Durable prefs in extension-origin **IndexedDB** `rvnUserPrefs`; signal-only local coordinator.
- Versioned JSON **Export / Import** in Studio; public `UserPreferencesV1` / `USER_PREFS_VERSION = 1` unchanged through v6.

### Privacy
- Capture, DSP, STT, and bake are **client-side**. Nothing leaves the machine until you download or attach.

---

## Unchanged contracts (v6 non-goals that held)

- No new extension execution context, message family, or preference version (`USER_PREFS_VERSION` stays **1**).
- No post-capture background re-position (architecturally impossible without re-recording — I1/I3/I23).
- No free-form custom style composition UI (curated presets + capped stackables only).
- No WebGL / new heavy runtime dependency beyond what the extension already ships.
- Hosted surface is feature-complete and tracks `main`; moment-to-moment pixel parity with every extension edge case is not promised.
- Package bump is this release only — tracks A–D landed under `5.11.0` until this tag.

---

## Architecture (as of this tag)

- Architecture map **v3.26** · extension-points **v1.42** · hardening backlog **v2.13** · ADRs **0001–0010** (0011 unallocated).
- Six contexts unchanged; Track D adds a second **host** for the Design Studio, not a seventh context.
- Host-neutrality rules (classify with `isOwnStorageOrigin()`, no `/assets/…` literals, `browser.*` not at module scope, etc.) gate the Pages build.

---

## Verify

```bash
# Extension
npm install
npm run compile          # must stay zero-error
npm run build

# Hosted Studio (CI-faithful: no root .wxt required for demo build)
cd demo && npm install && npm run build && npm run preview
# First step of demo build: npm run test:host-neutrality (from root scripts via demo package)

# Representative focused suites (v6 tracks)
node scripts/test-style-control-center.mjs
node scripts/test-host-neutrality.mjs
node scripts/test-relay-pipeline-host.mjs
node scripts/test-background-layout.mjs
node scripts/test-user-prefs-storage.mjs
```

---

## QA sign-off

| Track | Gate | Result |
|-------|------|--------|
| **A** | Confidence QA (Pass E) | **PASS** · Conway long-horizon residual accepted |
| **B** | Full operator checklist | **PASS** · focused automation 89/89 · blur+GIF size PASS |
| **C** | Agent visual gate | **PASS** · §8 real-extension eyeball optional |
| **D** | Phases 0–4 + real Pages 5.7 | **PASS** 2026-07-23 · Vosk captions operator-confirmed |
| **Field Guide** | Build + render + a11y spot-check | **PASS** 2026-07-23 |

Evidence workspaces: [`qa/QA-6.0.0/`](../qa/QA-6.0.0/).

---

## Deferred (explicitly out of v6.0.0)

- Free-form user style composition / arbitrary stackable chains (v6.1+ candidate).
- Preference Import merge/union mode ([`future-ideas.md`](future-ideas.md)).
- Multi-aspect *export* (framing guides only).
- Video backgrounds.
- Post-capture background re-edit.
- Minimized-window bake scheduling experiments beyond the documented RAF-throttle explanation.

---

## Upgrade checklist

1. Install / update the extension zip (or load unpacked from `.output` after `npm run build`), **or** open the [hosted Design Studio](https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/).
2. Extension: **Reload** when the popup shows the restart caution (or from `chrome://extensions`).
3. Open Design Studio → confirm Style Control Center + Background panel; record a short take → caption → bake → download.
4. Optional: walk the [Field Guide](https://bra-khet.github.io/reddit-voice-notes-chrome/tutorial/).
5. Existing users: profiles/styles/backgrounds should load unchanged; try a new spectrum + one stackable and a background drag to see v6 visuals.

---

## Doc index for this release

| Doc | Role |
|-----|------|
| This file | Release notes + GitHub summary |
| [`v6.0.0-custom-styles-refactor.md`](v6.0.0-custom-styles-refactor.md) | Track A as-built |
| [`v6.0.0-background-panel-refactor.md`](v6.0.0-background-panel-refactor.md) | Track B as-built |
| [`v6.0.0-popup-ui-refresh.md`](v6.0.0-popup-ui-refresh.md) | Track C as-built |
| [`v6.0.0-hosted-design-studio.md`](v6.0.0-hosted-design-studio.md) | Track D as-built |
| [`HISTORY.md`](HISTORY.md) | Milestone index |
| Prior notes | [`release-notes-v5.11.0.md`](../archive/docs/release-notes-v5.11.0.md) *(archived at this ship)* · [`release-notes-v5.10.0.md`](../archive/docs/release-notes-v5.10.0.md) *(archived)* |

---

*Push of `main` + tag is user-owned per repo convention.*
