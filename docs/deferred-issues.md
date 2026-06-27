# Deferred Issues

Consciously-deferred issues — reproducible problems we have **decided not to fix (yet)**
because the cost/risk outweighs the value, the trigger is not a real use case, or the root
cause is outside our code. This is distinct from:

- **`docs/bug-archive.md`** — *fixed* bugs + their root-cause forensics (and a "Deferred
  architectural rework" section for BUG-001-class transport work).
- **`docs/architecture/hardening-backlog.md`** — architecture hardening items (H1–H5).
- **`docs/design-studio.md` §11 / "Out of scope"** — Studio UI polish open items
  (font picker, slider vertical drop-off, card icon tint).

Each entry records: what it is, how to reproduce, why it's deferred, what would un-defer it,
and the blast-radius of attempting a fix now.

---

## DEF-001 — Cold-start "inference-error" under record/stop spam (MV3 offscreen boot)

**Status:** Deferred (accepted) — 2026-06-27
**Related:** `docs/bug-archive.md` BUG-034 (the *common-path* version of this race, **fixed**)

### What it is

The same offscreen **dispatch race** that BUG-034 fixed for the normal first-recording path
can still be forced at the extreme edge: when the offscreen document is **cold** (just booting)
and the user **spams record → stop → record** rapidly, a transcribe dispatch can still lose the
race against the booting document and surface as a single `inference-error` scaffold.

### How to reproduce (deliberately adversarial)

- Fully cold start (fresh extension load, no prior offscreen doc), **then**
- Spam start/stop recording rapidly during the first ~1–2 s of offscreen boot, **or**
- Sub-2-second **silent** clips fired back-to-back from cold.
- Split-tab mode appears to **widen** the window (more contention during boot), though this was
  judged *not necessarily* diagnostic of our code specifically.

It does **not** reproduce in normal single-recording use: BUG-034's mutex + ping guard + eager
prewarm cover the real first-fire path. The QA pass confirmed normal cold-start speech clips and
the no-speech/failure path now behave correctly and surface in the Profile Status modal.

### Why it's deferred

- **Not a real use case.** A user only hits it by intentionally spamming the recorder during the
  boot window — "just messing around." No organic workflow surfaces it.
- **Root cause is partly outside our code.** This is in large part a **Manifest V3 offscreen
  document boot characteristic** — `chrome.offscreen.createDocument` + worker spin-up has inherent
  latency the page can't fully serialize away during a contention storm.
- **A fix risks net-negative stability.** Forcing the pipeline to absorb spam-like behavior
  (e.g. queuing/locking harder, or blocking record during boot) would add complexity to the
  hot dispatch path and risks re-introducing a BUG-032/033/034-class race elsewhere. It is not a
  sharp edge for real users; hardening it further is poor ROI.

### What would un-defer it

- A reproducible report from **normal** (non-spam) use, or
- A clean way to make the offscreen boot atomically claim its dispatch slot **without** widening
  the hot path — e.g. a boot-complete gate the recorder can await cheaply before the first
  dispatch, proven not to regress the BUG-034 fix.

### Blast radius if attempted now

Touches the same `entrypoints/background.ts` dispatch choke point as BUG-032/033/034. Any change
there is high-surface and race-prone; mitigations have historically spawned sibling races. Defer
until there is real-use evidence.
