# Phase playbooks — methodology & heuristics

Detailed execution guidance for each phase of `architecture-hardening`. Read the
matching section before running a phase. `SKILL.md` has the short version +
success criteria; this file has the *how* and the judgment calls.

Throughout: **cite evidence** (`file:line`, doc §, or `BUG-###`). An assertion
without a pointer is a Phase-2 finding waiting to happen.

---

## Phase 1 — Mapping & Visualization

### Order of operations
1. Read `repo-map.md`, then the existing `docs/architecture/architecture-map.md`
   (if present). Diff your mental model against it — you are *updating*, not
   regenerating.
2. Confirm the context/CSP table against `wxt.config.ts` (CSP can change).
3. Enumerate the wire from `src/messaging/types.ts` — this is the cheapest way to
   see every pipeline and payload without reading each worker.
4. Confirm storage owners against `docs/design-studio.md` §3.2 and the
   `src/storage/*-db.ts` files.

### Diagrams to maintain (recipes in `diagram-cookbook.md`)
- **Context map** (`flowchart`): six contexts + edges labelled with the message
  family or signal that crosses them. This is the "who talks to whom".
- **Data flow** (`flowchart`): `stopRecording()` → fork → transcode/transcribe →
  Studio edit → bake → attach. Mark which artifacts land in which IDB store.
- **State machine** (`stateDiagram-v2`): pick ONE load-bearing lifecycle. Good
  candidates: a job's `START→ACK→PROGRESS→COMPLETE/CANCEL/FAIL`, or
  `rvn.workflow.phase`. Don't try to draw all state at once.
- **Sequence** (`sequenceDiagram`): one pipeline across content → background →
  offscreen, showing the relay hop and the `jobId→tabId` lookup. This is where
  the relay fragility becomes visible.

### Heuristics
- **Render-check** every diagram (Mermaid syntax errors are silent in plain MD).
- Prefer **stable identifiers** over line numbers in diagrams (message constants,
  store names, function names) — they survive refactors; line numbers don't.
- If a diagram needs >~15 nodes, you're mixing altitudes — split it.
- The map is an **index + cross-cutting view**, not a re-host of Studio internals.
  Link to `design-studio.md`; don't restate it.

### Done when
The success criteria in `SKILL.md` are met *and* you can answer "where would a
new X live?" for X ∈ {voice effect, subtitle effect, IDB store, message family}
straight from the map + extension-points registry.

---

## Phase 2 — Deep Understanding & Self-Critique

The value here is **honesty about uncertainty**. A confident-sounding map that's
subtly wrong costs more than an explicit "I'm not sure about Y."

### Invariant extraction
For each first-class concern, write the invariant as a falsifiable sentence and
cite its enforcer. Examples grounded in this repo:
- *Preview=bake:* "Anything in Live preview is reproducible by transcode or
  burn-in" — `docs/design-studio.md` §3.3; enforced informally, so flag where it
  could silently drift (a preview-only effect with no bake path is a violation).
- *STT input purity:* "Transcription consumes the raw WebM clone, not the
  voice-modulated export" — `transcription-architecture.md` Layer model.
- *Relay survival:* "A replaced/failed job still broadcasts failure before its
  `jobId→tabId` entry is deleted" — BUG-032; `background.ts` failure relays.
- *Semantic health:* "Timeouts fire on meaningful progress, not heartbeats" —
  `engineering-principles.md` § semantic health; `transcoder.ts isMeaningfulProgress`.

### Money-path traces (do ≥2)
Walk a real user outcome through every context and verify the code matches the
map. Strong candidates:
- **Subtitle round-trip:** record → transcribe fork → `rvnSessionTranscript` →
  Studio poll → segment edit → Confirm & save → bake → `rvnLastBakedMp4` →
  `bakedMp4.ready` → recorder attach.
- **Personal background WYSIWYG:** Studio reads `rvnImageDb` directly, but the
  recorder (reddit.com) relays bytes via `BACKGROUND_BLOB_PORT` → canvas.
- **Voice effect:** Studio preview (`preview-chain.ts`, Web Audio) vs export
  (`-af` in transcode) — confirm both read the same resolved config.

### Self-critique checklist (write the answers down)
- Which claims did I *assume* vs *verify*? List the assumed ones.
- Where do two docs (or doc vs code) disagree? Name both.
- What coupling surprised me? (e.g. burn-in must wait for the transcribe queue to
  idle — a cross-pipeline dependency that isn't obvious from `types.ts`.)
- "If I changed X, what breaks?" for each first-class concern.
- **Confidence ledger:** subsystem → High/Med/Low → one-line evidence.

Open ADR stubs (`assets/adr.template.md`) for anything that needs a decision —
a stub with just Context + Question is fine; Phase 3 or a feature may resolve it.

---

## Phase 3 — Targeted Hardening (scoped)

The failure mode to avoid is a refactor wishlist. This repo's own principles say
to ship the *smallest faithful change* and document the gap — apply that here.

### Candidate generation
Pull from two wells:
1. **Phase-2 Low-confidence** items (uncertainty is risk).
2. **Recurring bug classes** in `bug-archive.md`. Look for *patterns*, not single
   bugs: relay-drop-on-failure, stale-offscreen-bundle, dirty-state collapse,
   payload-size/base64 ceilings, cross-pipeline races. A class that bit twice
   will bite the next feature too.

### ROI scoring (keep only the high ones)
```
ROI ≈ (impact_on_upcoming_work × bug_likelihood) ÷ cost
```
- *impact_on_upcoming_work* — does it make a planned/likely feature cleaner?
- *bug_likelihood* — has this class already recurred? Is it on a hot seam?
- *cost* — lines touched, blast radius, test burden. If cost spans contexts,
  it's probably too big for one item — split or defer.

### Scope each kept item (template)
- **Item / class it kills**
- **Evidence** (`BUG-###` or Phase-2 finding)
- **Invariant it protects** (ties back to a first-class concern)
- **Surgical change** (files, ~size)
- **Blast radius** (what could regress; which contexts)
- **Verification hook** (manual QA step or `compile`/build check)
- **Out of scope / Non-goals** — *mandatory*. Name the bigger, tempting version
  you are deliberately **not** doing, and why. (e.g. "Not restoring libass for
  smooth rainbow — BUG-025 silent-failure risk outweighs the fidelity gain;
  stepped slices stay.") This line is the anti-over-engineering guard.

### When you actually change code
Use the repo's bug-fix comment style at every touched site:
```
// BUG FIX: <name>
// Fix: <what was wrong / what changed>
// Sync: <other locations that must stay in sync>   (omit if only one site)
```
Run `npm run compile` and, for pipeline changes, a record→Studio→bake smoke pass.

---

## Phase 4 — Living-Documentation Standards

### Placement & linkage
- New architecture docs → `docs/architecture/`.
- Maintain `docs/architecture/README.md` as the **outbound index** (mirror the
  `design-studio.md` §12 pattern) and add an **inbound** link from each doc back
  to its canonical owner.
- Header every living doc with: status, audience, the stable tag/branch it
  reflects, and a one-line "this file wins for current <topic>" claim.

### Versioning & changelog
- `architecture-map.md`: `vMAJOR.MINOR`; MINOR for additive refresh, MAJOR when
  a context/pipeline/storage class is added or removed. Dated changelog at top.
- Registries (`extension-points.md`, `hardening-backlog.md`) version
  independently — e.g. "Voice Effects Extension Points v2".

### Carry-forward block (the anti-context-loss device)
End every major doc with a fenced, ≤20-line block a user can paste into a brand
new chat to re-seed it. It should name: branch, map version, the four first-class
concerns' current state in a phrase each, the top open question, and the single
command to re-run (`architecture-hardening resume`). Keep it copy-paste clean —
no prose around it.

### Update-don't-duplicate
Before creating a file, grep `docs/` for the topic. Extend the canonical owner if
one exists. Only create new for a genuinely new subsystem. State the grep result
in your response ("checked docs/ for X; extending design-studio.md §N").

---

## Feature-integration mode

Run this instead of the full sweep when the user is about to build something.

1. **Locate the seam.** Which extension point does it use
   (`docs/architecture/extension-points.md`)? If none fits, that gap *is* the
   first finding — propose where the seam should be.
2. **Test against the four concerns:**
   - *Preview↔bake:* does it need a preview path AND a bake path? Will they
     agree, or is there a fidelity gap to quantize/document up front?
   - *Effect composition:* which layer (voice/bars/subtitles) — or a new one? New
     layers change compositing order; call that out.
   - *Message contracts:* new message family? Reuse the START→ACK→…→COMPLETE
     shape and add to `src/messaging/types.ts`.
   - *State ownership:* new datum → prefs or IDB? Who's the single writer? New
     `*.ready` signal?
3. **Emit only the hardening that de-risks *this* feature** (mini Phase 3).
4. **Output an ADR** (`assets/adr.template.md`) proposing the integration, and
   update the extension-points registry if a new seam is introduced.

The win: the feature lands cleaner *because* the integration was reasoned about
against the spine before code was written — and the ADR captures *why* for the
session that maintains it later.
