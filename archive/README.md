# Archive — Reddit Voice Notes

> **Immutable historical layer. Do not edit files in here.**
> Initialized **2026-07-06** at the **v5.4.0 (Design Studio First)** milestone via the `/docs-archiving` skill.
> Extended **2026-07-10** (first Refresh) at the **v5.8.0 (Timeline Visual Subtitle Editor)** milestone — added `progress/claude-progress-pre-v5.8.0.md` and archived the v5.3.9 → v5.5.1 release notes.
> Extended **2026-07-11** (Refresh #2) after **v5.9.0 (Atomic Trim Apply)** shipped — added `progress/claude-progress-through-v5.9.0.md` and archived the v5.6.0 → v5.8.0 release notes.
> Extended **2026-07-12** (Refresh #3) after **v5.10.0 (Raw Trim Apply)** shipped + real-browser QA PASS — added `progress/claude-progress-through-v5.10.0.md` and archived the v5.9.0 release notes.
> Extended **2026-07-20** (Refresh #4) after all three **v6.0 Polish & Visual Maturity tracks** merged — added `progress/claude-progress-through-v6.0.0-tracks.md` and slimmed the living progress file to the release boundary.

This directory is the **raw/verbose history** tier of the project's two-tier documentation model:

- **Living layer** (repo root + `docs/`): slim, actively maintained — `claude-progress.md`, the canonical reference docs, `docs/architecture/`, and the milestone index `docs/HISTORY.md`.
- **Archive layer** (here): full, point-in-time history that never gets edited. Living docs link in only when deeper history is actually needed (*conditional disclosure*).

If you're getting oriented, start at [`docs/HISTORY.md`](../docs/HISTORY.md) — it indexes every milestone and points here only where the detail lives.

---

## Contents

### `progress/`
Root-level session and branch progress logs, superseded by the slimmed living `claude-progress.md`.

| File | What it is |
|------|-----------|
| `claude-progress-through-v6.0.0-tracks.md` | **Full** v5.11.0 + v6.0 Tracks A/B/C development log through the Track B full operator PASS and all-track merge. Added by the 2026-07-20 Refresh #4; package was still 5.11.0 pending the explicit v6 release. |
| `claude-progress-through-v5.10.0.md` | **Full** raw-trim-apply progress log (v5.9.0 → v5.10.0), including real-browser QA PASS and the accepted IDB-nuke observation. Added by the 2026-07-12 Refresh #3. |
| `claude-progress-through-v5.9.0.md` | **Full** timeline-and-trim progress log (v5.8.0 → v5.9.0), including real-browser QA and post-QA fixes. Added by the 2026-07-11 Refresh #2. |
| `claude-progress-pre-v5.8.0.md` | **Full** editing-suite-arc progress log (v5.7.0 → v5.4.0, incl. v5.5.x / v5.3.10 handoff) as it stood entering v5.8.0. Added by the 2026-07-10 Refresh. |
| `claude-progress-pre-v5.4.0.md` | **Full** session progress log (v5.3.10 → v1.0.0 MVP) as it stood at v5.4.0. Together, the five snapshots preserve complete history through the merged v6 development tracks; the living root `claude-progress.md` keeps only current release-boundary state. |
| `dulcet-branch.md` | v3 voice-effects (Dulcet) branch phase plan. |
| `eloquent-branch.md` | v4 subtitle (Eloquent) branch phase plan. |
| `pretty-branch.md` | v2 personalization (pretty) branch phase plan — bar style / background origin. |

### `docs/`
Shipped release notes and resolved handoff/checkpoint docs. **Design docs for shipped features stayed in the living `docs/`** because the architecture docs cite them as active canon — only inert records live here.

| File(s) | What it is |
|---------|-----------|
| `release-notes-v3.1.0.md` … `release-notes-v5.9.0.md` (21) | Per-version release notes for shipped tags v3.1.0, v3.7.0, v4.0.0, v5.0.0, and v5.3.0 → v5.9.0. The latest **v5.10.0** notes remain living in `docs/`. |
| `eloquent-4-handoff.md` | Resolved v4 subtitle-bake QA handoff (BUG-025…032). |
| `eloquent-profile-checkpoint.md` | **Historical** profile bug-cluster audit (superseded for semantics). |
| `eloquent-profile-checkpoint-hydrated.md` | **Historical** BUG-023 checkpoint. |
| `5.3.x-version-swapping-log.md` | Ops log of v5.3.x version-swap testing. |

---

## Rules for this archive

- **Never edit** an archived file — it is a point-in-time capture. New work goes in the living layer.
- **Internal cross-references reflect archive-time state.** An archived file may still say `docs/…` for a doc that has since moved or changed; that is intentional (it records what was true then). Living docs, by contrast, are kept link-correct.
- **Extending the archive:** future `/docs-archiving` **Refresh** runs add new dated snapshots here (e.g. `progress/claude-progress-through-<next-milestone>.md`) and never overwrite existing ones.
