---
name: architecture-hardening
description: >-
  Map, audit, and harden the architecture of this Chrome MV3 / WXT browser
  extension, and keep living, versioned, diagram-rich docs in docs/architecture/
  that survive context loss between sessions. Use this skill WHENEVER the user
  wants to understand or document how the extension fits together; trace data,
  message, or state flow across the content-script / background / offscreen /
  vosk-sandbox / Design-Studio layers; review maintainability, tech debt,
  coupling, or the preview-vs-bake boundary; plan how a NEW feature (voice
  effect, subtitle effect, pipeline, storage store, message family) will
  integrate BEFORE building it; or asks for an architecture diagram, ADR,
  extension-point map, or a "get me back up to speed on this codebase" summary.
  Also trigger on phrases like "architecture map", "harden", "tech-debt audit",
  "how does X flow", "where does state live", "message contracts", "extension
  points", or right before a large refactor. Strongly prefer this skill over
  ad-hoc code exploration so hard-won context is captured durably instead of
  re-derived and lost.
---

# Architecture Analysis & Hardening

A repeatable, four-phase workflow for understanding, documenting, and
incrementally hardening the **Reddit Voice Notes** Chrome extension as it grows.

The product it serves is unusual: six CSP-distinct execution contexts, three
near-identical WASM pipelines, and a strict **preview-must-equal-bake** promise.
That complexity is manageable only if each session can regain deep context fast
and leave the next session better-oriented than it found it. **That carry-forward
is the whole point of this skill** — every artifact you produce is written for a
future reader (human or AI) who has *no memory of this conversation*.

## The prime directive: don't re-derive, extend

Before exploring code, **read what already exists** — re-deriving the map from
scratch wastes the session and risks contradicting documented truth:

1. `references/repo-map.md` — the durable skeleton of this repo (contexts,
   boundaries, message families, storage owners, key files). Your 60-second
   re-orientation. Read it first, every time.
2. `docs/architecture/architecture-map.md` — the **living, versioned** map this
   skill maintains (may not exist yet on first run — Phase 1 creates it).
3. The canonical subsystem docs, which **win on their topic** and must not be
   duplicated:
   - `docs/design-studio.md` — Studio semantics, preview=bake, dirty layers,
     storage map (the outbound index lives in its §12).
   - `docs/transcription-architecture.md` — Vosk sandbox CSP stack.
   - `docs/engineering-principles.md` — semantic health, save pathways,
     pipeline-native effects.
   - `docs/bug-archive.md` — `BUG-###` history; the raw material for Phase 3.

If something in the code contradicts these docs, that is a **finding**, not a
fact to silently absorb — surface it (Phase 2) rather than overwriting either.

## Four phases (run all, or name one)

Each phase has a **Goal**, **Steps**, **Artifacts**, and **Success criteria**.
You can run the whole sequence or a single phase (see Invocation templates).
Detailed methodology and heuristics for every phase live in
`references/phase-playbooks.md` — read the matching section before running a phase.
Mermaid recipes live in `references/diagram-cookbook.md`.

---

### Phase 1 — Architecture Mapping & Visualization

**Goal:** A referenceable, visual, *current* map that a newcomer can use to
locate any subsystem in under two minutes.

**Steps:**
1. Re-orient from `references/repo-map.md` + the existing living map.
2. Inventory the **execution contexts** and their CSP boundaries (the fixes that
   do *not* transfer between layers are the high-value part — see repo-map).
3. Draw/refresh four diagram families with Mermaid (recipes in the cookbook):
   - **Context map** — the six contexts and who talks to whom.
   - **Data flow** — record → transcode / transcribe (fork) → edit → bake → attach.
   - **State machine** — one load-bearing lifecycle (job states, or `rvn.workflow.phase`).
   - **Sequence** — one message pipeline end-to-end (START→ACK→OFFSCREEN→PROGRESS→COMPLETE/CANCEL + relay).
4. Write/refresh the **four first-class concern** sections — these are the spine
   of this codebase and must always be present:
   **preview↔bake boundary · effect composition · message contracts · state ownership.**
5. Refresh the **extension-points registry** (`docs/architecture/extension-points.md`)
   — the seams where new effects/pipelines/stores plug in, versioned (e.g.
   "Voice Effects Extension Points v2").
6. Bump the map version and add a dated changelog line.

**Artifacts:** `docs/architecture/architecture-map.md` (versioned, Mermaid
embedded) · `docs/architecture/extension-points.md` (versioned).

**Success criteria:**
- Every execution context, message family, and storage owner appears in the map.
- All four first-class concerns have a current section.
- Each diagram is spot-checked against code (cite the file you verified against).
- Version bumped; changelog dated; a "Resume in a new chat" block present (Phase 4).

---

### Phase 2 — Deep Understanding & Self-Critique

**Goal:** Move past description to the **load-bearing invariants** — and be
honest about where understanding is thin. A map that hides its own uncertainty
is worse than no map.

**Steps:**
1. For each first-class boundary, state the **invariant in one sentence** and
   cite the file (and line if stable) that enforces it. Example invariant: "STT
   reads the *raw* WebM clone, never the voice-modulated export."
2. Trace **≥2 money paths** end-to-end (e.g. a subtitle from Vosk → segment edit
   → Confirm & save → bake → attach). Confirm the map predicts the code.
3. **Self-critique, explicitly** (don't bury it): assumptions you could not
   verify; places two docs disagree; coupling that surprised you; "what breaks
   if I change X." Rate confidence per subsystem **High / Med / Low** with evidence.
4. Record results as an **Invariants** section + a **Confidence ledger** in the
   map; open ADR *stubs* (`assets/adr.template.md`) for anything needing a decision.

**Artifacts:** Invariants + Confidence-ledger sections in the map · ADR stubs in
`docs/architecture/adr/`.

**Success criteria:**
- Every first-class concern has a one-line invariant + enforcing reference.
- ≥2 documented money-path traces.
- An explicit Low-confidence list exists — **no silent guesses**.

---

### Phase 3 — Targeted Hardening (scoped, not blanket)

**Goal:** The smallest changes that remove a *class* of future bugs or make the
*next* feature cheaper. This is anticipatory, high-ROI hardening — **not** a
refactor crusade.

**Steps:**
1. Generate candidates from Phase-2 Low-confidence items + recurring bug classes
   in `bug-archive.md` (e.g. relay-drop-on-failure, stale-offscreen, dirty-state
   collapse). Each candidate cites evidence.
2. Score each: **(impact on upcoming work × bug likelihood) ÷ cost.** Keep only
   the high-ROI few.
3. For each kept item, scope a **surgical** change: the invariant it protects,
   the blast radius, a test/QA hook, and — critically — an explicit
   **Out of scope / Non-goals** line that names the over-engineering you are
   *rejecting* and why (this guard is mandatory; see the repo's own
   "pipeline-native solutions" principle).
4. If a feature is planned, show how each item makes that integration cleaner.
5. Annotate any code you actually change with the repo's bug-fix comment style.

**Artifacts:** "Hardening Backlog vN" (ranked table: item · evidence · ROI ·
blast radius · non-goals) in `docs/architecture/hardening-backlog.md` · ADRs for
structural choices.

**Success criteria:**
- Every item cites evidence (bug ref or Phase-2 finding).
- Every item has explicit scope **and** non-goals.
- Nothing exceeds one focused sprint; at least one tempting-but-rejected
  over-engineering is named with its reason.

---

### Phase 4 — Living-Documentation Standards & Update Process

**Goal:** Guarantee the artifacts stay current and **survive context loss**, by
*extending* this repo's existing doc conventions rather than forking parallel docs.

**Steps:**
1. **Placement & linkage:** new architecture docs live in `docs/architecture/`;
   link them into the existing inbound/outbound index (the `design-studio.md` §12
   pattern). Give each a canonical "this file wins on its topic" header.
2. **Versioning:** every living doc carries `vMAJOR.MINOR` + a dated changelog;
   registries (extension-points, hardening backlog) version independently.
3. **Update triggers:** enumerate what forces a re-run — new execution context,
   new message family, new IDB store, new effect type, or a bug class repeating.
4. **Carry-forward block:** end every major doc with a ≤20-line "Resume in a new
   chat" block that re-seeds a cold session (paste-ready).
5. **Update-don't-duplicate:** before creating any doc, grep `docs/` for the
   topic; extend the canonical owner; only create a new file for a genuinely new
   subsystem. Verify with grep and say so.

**Artifacts:** `docs/architecture/README.md` (index + standards) · carry-forward
blocks appended to each living doc.

**Success criteria:**
- Index links resolve; every living doc has version + changelog + carry-forward block.
- Update triggers are enumerated.
- No parallel/duplicate doc created (grep-verified and stated).

---

## Feature-integration mode (cross-phase)

When the user is *about to add* a feature, don't run the full sweep — run the
focused integration analysis in `references/phase-playbooks.md`
(§ Feature integration). In short: locate the **extension point** it should use;
check it against the four first-class concerns (especially: does it need a
preview *and* a bake path, and do those agree?); name the **message/state**
surface it touches; then emit only the Phase-3 hardening that de-risks *this*
addition. Output an ADR proposing the integration.

## Update-don't-duplicate rules (read before writing any doc)

- The canonical docs **win on their topic.** Add a cross-link; never restate
  their content in `docs/architecture/`. The architecture map is the *index and
  cross-cutting view*, not a re-host of Studio or transcription internals.
- One topic → one home. If you're tempted to create `architecture-map-v2.md`,
  you're doing it wrong: bump the version *inside* the existing file.
- When superseding older notes, follow the repo's pattern — state "this file
  wins for current X; older docs remain authoritative for history."
- Keep the outbound index in `docs/architecture/README.md` and add an inbound
  link from any doc you touch back to the relevant canonical owner.

## Invocation templates (paste these in a future session)

- **Full pass:** "Run architecture-hardening on the current branch — refresh the
  map and give me the confidence ledger + hardening backlog."
- **Phase 1 only:** "architecture-hardening Phase 1 — refresh the architecture
  map and diagrams for `<branch>`."
- **Phase 3 only:** "architecture-hardening Phase 3 — I'm about to add
  `<feature>`; give me scoped, evidence-backed hardening with non-goals."
- **Feature integration:** "architecture-hardening feature-integration — analyze
  how `<feature>` fits the current map and propose an ADR."
- **Cold resume:** "architecture-hardening resume — read docs/architecture/ and
  tell me the current architecture state and open questions in ~15 lines."

## Files in this skill

| Path | Read when |
|------|-----------|
| `references/repo-map.md` | Always first — durable repo skeleton + key files. |
| `references/phase-playbooks.md` | Before running any phase — full methodology + heuristics. |
| `references/diagram-cookbook.md` | When drawing/refreshing Mermaid diagrams. |
| `assets/architecture-map.template.md` | First Phase-1 run — copy to `docs/architecture/architecture-map.md`. |
| `assets/extension-points.template.md` | First extension-points run. |
| `assets/adr.template.md` | Every ADR (Phase 2/3/feature-integration). |
