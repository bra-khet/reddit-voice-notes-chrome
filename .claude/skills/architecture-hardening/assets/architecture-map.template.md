<!--
  TEMPLATE — copy to docs/architecture/architecture-map.md on first Phase 1 run.
  Then fill placeholders, embed current diagrams (see skill diagram-cookbook),
  and DELETE this comment. Thereafter, UPDATE this file in place and bump the
  version — never create architecture-map-v2.md.
-->

# Architecture Map — Reddit Voice Notes

**Version:** v1.0 · **Reflects branch/tag:** `<branch-or-tag>` · **Updated:** `<YYYY-MM-DD>`
**Status:** Canonical cross-cutting architecture index. Wins for *how subsystems
fit together*; subsystem internals are owned by the canonical docs linked below.
**Re-run:** `architecture-hardening` (full) or a named phase.

### Changelog
- `v1.0` (`<YYYY-MM-DD>`) — initial map.

> Bump MINOR for additive refreshes; MAJOR when a context, pipeline, or storage
> class is added/removed. Keep newest entry on top.

---

## 1. Execution contexts

<!-- Confirm against wxt.config.ts. See skill references/repo-map.md for the table. -->

| Context | Origin / CSP | eval | chrome.* | Responsibility | Entry |
|---------|--------------|------|----------|----------------|-------|
| Content script | reddit.com, isolated | n/a | limited | recorder, composer, capture | `entrypoints/content.ts` |
| Background SW | ext, wasm-unsafe-eval | no | yes | relay, offscreen lifecycle | `entrypoints/background.ts` |
| Offscreen | ext, wasm-unsafe-eval | no | yes | FFmpeg transcode + burn-in | `entrypoints/offscreen/main.ts` |
| Sandbox | opaque, unsafe-eval | yes | no | Vosk STT | `public/vosk-sandbox.html` |
| Design Studio | ext page | no | yes | preview/edit/bake | `entrypoints/design-studio/` |
| Popup | ext page | no | yes | quick settings | `entrypoints/popup/` |

**Boundary note:** fixes do not transfer between contexts (different CSP/origin).

## 2. Diagrams

### 2.1 Context map
```mermaid
<!-- paste from diagram-cookbook §1, corrected to current code -->
```

### 2.2 Data flow (record → attach)
```mermaid
<!-- diagram-cookbook §2 -->
```

### 2.3 State machine
```mermaid
<!-- diagram-cookbook §3 — pick one lifecycle -->
```

### 2.4 Pipeline sequence + relay
```mermaid
<!-- diagram-cookbook §4 -->
```

## 3. First-class concerns

### 3.1 Preview ↔ bake boundary
- **Current state:** `<one paragraph>`
- **Invariant:** `<falsifiable sentence>` — enforced/cited at `<file / doc §>`
- **Known fidelity gaps:** `<e.g. rainbow → stepped slices>`

### 3.2 Effect composition
- **Layers:** voice (`-af`) · bars (canvas) · subtitles (drawtext burn-in)
- **Compositing order:** `<bottom→top>`
- **Invariant:** `<sentence>` — `<ref>`

### 3.3 Message contracts
- **Registry:** `src/messaging/types.ts`
- **Pipelines:** transcode · transcribe · burn-in (shared START→ACK→…→COMPLETE)
- **Relay:** `<jobId→tabId summary>` — `<ref>`
- **Invariant:** `<sentence>` — `<ref>`

### 3.4 State ownership
- **prefs (`rvnUserPrefs`):** `<what>`
- **IDB stores:** `<the 5 stores, one line each>`
- **signals (`rvn.*.ready`):** `<list>`
- **Invariant:** one writer per datum; blobs/text never in prefs — `<ref>`

## 4. Invariants (Phase 2)

| # | Invariant | First-class concern | Enforced at | Confidence |
|---|-----------|---------------------|-------------|------------|
| 1 | `<...>` | preview↔bake | `<file>` | High/Med/Low |

## 5. Confidence ledger (Phase 2)

| Subsystem | Confidence | Evidence / why |
|-----------|-----------|----------------|
| `<...>` | `<H/M/L>` | `<...>` |

**Open questions / low-confidence:**
- `<...>` → ADR stub `<docs/architecture/adr/NNNN-*.md>`

## 6. Related docs

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics, preview=bake, storage map |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack |
| `docs/engineering-principles.md` | semantic health, save pathways, pipeline-native |
| `docs/bug-archive.md` | bug history |
| `docs/architecture/extension-points.md` | where new features plug in |
| `docs/architecture/hardening-backlog.md` | ranked hardening items |

---

## Resume in a new chat (carry-forward)

```
architecture-hardening resume.
Repo: Reddit Voice Notes (Chrome MV3 / WXT). Branch: <branch>. Map: v<X.Y>.
Contexts: content / background / offscreen(FFmpeg) / sandbox(Vosk) / Design Studio / popup.
Spine: preview=bake | effects: voice(-af)+bars(canvas)+subs(drawtext) | wire: src/messaging/types.ts | state: rvnUserPrefs + 5 IDB stores + rvn.*.ready.
First-class status: preview↔bake=<...>; composition=<...>; contracts=<...>; state=<...>.
Top open question: <...>.
Read docs/architecture/architecture-map.md then continue.
```
