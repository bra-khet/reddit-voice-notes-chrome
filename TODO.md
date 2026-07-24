# TODO — Post-v6.0.0

<!--
CHANGED: Marked the Profile actions control deck complete and advanced the ordered queue to reset semantics.
WHY: Current handoff must preserve the delivered profile UI/storage contract while keeping the next sprint bounded.
-->

## Archive Notice (Living Document)

The v6 ship-time task ledger is preserved at [`archive/progress/TODO-at-v6.0.0-stable.md`](archive/progress/TODO-at-v6.0.0-stable.md). Shipped milestones live in [`docs/HISTORY.md`](docs/HISTORY.md). Product detail for unscheduled ideas remains in [`docs/future-ideas.md`](docs/future-ideas.md).

## Ordered polish queue (post-v6)

Work **one bounded slice at a time**. Order is intentional; completed items stay checked so later sessions do not re-run them.

| # | Status | Item | Priority | Effort | Why this order |
|---|--------|------|----------|--------|----------------|
| **1** | ✅ Done | **Smart Adjust — cue-adjacency gate for word-shift** | High | Small | Shipped in the post-v6 polish sprint; details and proof below. |
| **2** | ✅ Done | **Profile actions menu** | Medium | Medium | Shipped as a responsive control deck with one accessible dialog primitive; details and proof below. |
| **3** | **Next** | **Reset to default / reset to blank** | Medium | Medium | Needs field inventory; can now reuse the menu/modal language established by #2. |
| **4** | Queued | **Preferences Import merge / union** | Low | Small–Medium | Storage-careful; ship after profile Import UX is settled (#2). |
| **5** | Queued | **Hosted orientation — sticky “Warming up” modal after Back** | Medium | Small–Medium | Separate hosted lifecycle bug; preserve queue order and diagnose only after #2–#4. |

Detail and acceptance criteria: sections below. Living design notes: [`docs/future-ideas.md`](docs/future-ideas.md). Handoff seed: [`claude-progress.md`](claude-progress.md).

---

### 1. Smart Adjust — cue-adjacency gate for word-shift

**Area:** `src/transcription/smart-adjust.ts` (+ tests, light copy if needed)

**Status:** ✅ Complete — 2026-07-23

**Problem:** Minimal-fix word-shift (`shift-word-next` / `shift-word-prev`) can be offered when the overflowing cue and its neighbor are a second or more apart. Shifting a word across that gap keeps text-fit but misaligns the word with the spoken audio.

**Change:**

- Word-shift is a **valid suggested minimal fix only when the two cues are adjacent or very close** — default threshold **≤ 0.2 s** inter-cue gap (use the time between `current.end` and `next.start`, or the symmetric prev gap; treat tiny overlaps / zero gap as adjacent).
- If the gap is **greater than the threshold**, do **not** emit that shift proposal (or rank it out of “minimal / one-click” eligibility). Prefer **split / re-splice** paths so timing stays aligned with audio.
- Re-evaluate both:
  - `collectMinimalFixProposals` (feeds **⚡ Apply minimal fix** and Smart Adjust leading list)
  - any ranking that treats the first word-shift as “smallest possible fix”
- Prefer a named constant (e.g. `WORD_SHIFT_MAX_GAP_SECONDS = 0.2`) over a magic number.
- Extend `scripts/test-smart-adjust.mjs` (or equivalent) for: gap ≤ threshold → shift allowed; gap > threshold → shift suppressed; re-splice still available.

**Out of scope for this slice:** Smart Adjust *trust UI* (before/after preview, overflow map) — still in future-ideas.

**Delivered:** `WORD_SHIFT_MAX_GAP_SECONDS = 0.2` gates both word-shift builders before text-fit ranking. Adjacent, overlapping, and exact-threshold cues remain eligible; larger gaps emit no shift proposal. `scripts/test-smart-adjust.mjs` covers both directions, minimal-fix suppression, and re-splice availability (9/9); `npm run compile` is zero-error.

---

### 2. Profile actions menu

**Area:** Design Studio profile chrome (Cividis-aligned)

**Status:** ✅ Complete — 2026-07-23

Consolidate profile management into one accessible actions menu:

- Add blank/default profile
- Import JSON
- Rename
- Clone
- Export JSON
- Delete with emphasized second-step confirmation

Rename and Clone share one modal primitive. Clone pre-fills `<name> (copy N)` with the first available positive integer.

Keep **Save Changes** outside the menu; reveal only while dirty; second-step confirmation language consistent with other updates; reserve layout space so the UI does not jump.

**Sprint contract example:** “Ship the profile actions menu shell + Rename/Clone/Delete confirm; leave Import merge strategy to item #4.”

**Delivered:** The Profile selector now has a responsive Cividis control-deck menu for Add, Import, Rename, Clone / dirty Save as new, Export, and Delete. Add can snapshot the current setup or create and activate a clean Classic/default profile. Rename preserves profile identity; Clone uses the first free `<name> (copy N)`; Delete uses an emphasized in-app second step. Dirty **Save changes** remains outside the menu in a reserved slot. The host-neutral controller provides grouped menu semantics, arrow/Home/End/Escape handling, focus return, a trapped shared dialog, phone bottom sheets, and short-viewport containment. Full-replace Import remains unchanged pending item #4.

**Proof:** `npm run test:profile-actions` **6/6**, `node scripts/test-user-prefs-storage.mjs` **14/14**, `npm run test:host-neutrality` **15/15**, and `npm run compile` zero errors. Desktop and 390 × 844 hosted Studio interaction checks covered Add, dynamic Clone/Save-as-new, confirmed Delete, keyboard focus, dirty Save visibility, and responsive containment with no console errors.

---

### 3. Reset to default / reset to blank

**Area:** Cross-panel usability

Two explicit operations where both meanings apply:

- **Reset to default:** restore the product/preset-derived value.
- **Reset to blank:** remove the optional override and let normal fallback resolution run.

Requirements: central semantics and copy; one reusable confirmation/modal pattern; normalization after reset; correct dirty-state; no reset of unrelated profile, transcript, or media state.

**Start with** an inventory of fields where “blank” and “default” are distinct, then implement a thin vertical slice (one panel or control family) before sweeping the product.

**Sprint contract example:** “Inventory blank-vs-default fields; implement reset on one panel family with shared modal + dirty integration.”

---

### 4. Preferences Import merge / union

**Area:** Prefs import path (IndexedDB / `enqueuePrefsOp`)

Beside today’s verified **full-replace** import, add an explicit **merge** strategy: keep existing profiles/styles not present in the import; add or overwrite incoming entities under documented conflict rules.

Keep: versioned envelope, normalizers, entity caps, atomic IDB replace path. **Not** cloud sync or CRDT.

Historical contract: [`archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md`](archive/docs/pre-v6.0.0/designs/v5.11.0-prefs-storage-refactor.md).

**Sprint contract example:** “Add merge import strategy + conflict rules + tests; full-replace remains default or explicit choice.”

---

### 5. Hosted orientation — sticky “Warming up the Design Studio” modal after Back

**Area:** Hosted orientation launch/navigation lifecycle

**Problem:** After the hosted Design Studio finishes loading, navigating Back to the hosted orientation page can restore a stale **Warming up the Design Studio** modal. The orientation page remains blocked until refresh.

**Acceptance:**

- Launch the hosted Design Studio from orientation and wait for it to become usable.
- Navigate Back to the orientation page.
- Orientation is immediately interactive with no stale warm-up modal and no refresh required.
- A new launch still shows the warm-up state only while startup is genuinely pending, then clears it on success or failure.
- Keep the fix in the hosted shell/lifecycle owner; do not introduce hosted policy into shared Studio modules.

**Sprint contract example:** “Clear stale hosted warm-up state when orientation is restored after Back navigation, while preserving the normal launch lifecycle.”

---

## Other open polish (not ordered)

- Smart Adjust visual trust cues (presentation only — do not fork measurement).
- Subtitle gradient/glow user-facing controls.
- Conway Life long-horizon corner parking (bounded rule only).
- Optional real-extension popup appearance check after future popup changes.

## Deferred engineering

- Encoder fallback reason in the production UI: revive only after a real-world silent fallback.
- Extreme cold-start record/stop spam race: accepted as [`DEF-001`](docs/deferred-issues.md).

## Required guardrails

- Design-phase backgrounds are captured into the base video; do not add post-capture repositioning.
- Reuse normalizers and existing preference/storage paths; do not bump `USER_PREFS_VERSION` casually.
- Shared Studio modules must remain host-neutral.
- `npm run compile` must remain zero-error.
- One well-defined sprint per exchange; do not combine queued items #2–#5 unless the user asks.
