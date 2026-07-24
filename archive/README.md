# Archive — Reddit Voice Notes

<!--
CHANGED: Documented the full v6.0.0 baseline refresh and the new navigable archive structure.
WHY: The archive now owns shipped design history as well as progress and release-note history.
-->

> **Historical layer. Archived payload files are immutable.**
> Start with [`docs/HISTORY.md`](../docs/HISTORY.md); use [`docs/MANIFEST.md`](docs/MANIFEST.md) only when deeper history is needed.

## Structure

| Path | Contents |
|------|----------|
| [`docs/MANIFEST.md`](docs/MANIFEST.md) | Source-to-archive map and provenance index |
| [`docs/pre-v6.0.0/`](docs/pre-v6.0.0/) | Completed pre-v6 design, roadmap, handoff, and review-gate documents moved from `docs/` |
| [`docs/v6.0.0-checkpoint/track-roadmaps/`](docs/v6.0.0-checkpoint/track-roadmaps/) | Completed v6 Tracks A/B/C/D roadmaps |
| [`docs/v6.0.0-checkpoint/living-snapshots/`](docs/v6.0.0-checkpoint/living-snapshots/) | Full pre-condensation copies of living reference docs |
| [`docs/release-notes-v*.md`](docs/) | Release notes through v5.11.0; v6.0.0 remains living |
| [`progress/`](progress/) | Root progress/TODO snapshots and historical branch logs |

## Refresh ledger

| Refresh | Boundary | Added |
|---------|----------|-------|
| Initialize | v5.4.0 · 2026-07-06 | Archive structure, early progress, release notes, handoffs |
| #1–#3 | v5.8.0–v5.10.0 · 2026-07-10–12 | Editing-suite progress and shipped release notes |
| #4 | merged v6 tracks · 2026-07-20 | Full v6 development progress |
| #5 | v6.0.0 tag · 2026-07-23 | Light ship refresh and v5.10/v5.11 notes |
| **#6** | **v6.0.0 full baseline · 2026-07-23** | **38 moved docs, 13 living-doc snapshots, root progress/TODO snapshots, manifest, and compact post-v6 canon** |

## Rules

- Do not edit archived payloads after their provenance header is established.
- Append new snapshots or manifest rows; never overwrite a prior capture.
- Archived internal links may reflect their original location and date. Living docs must remain link-correct.
- Keep source decisions intact. Condense only after the original content has a verified archive copy.
- Do not use the archive as default agent context. Follow a living-document pointer only when current canon is insufficient.
