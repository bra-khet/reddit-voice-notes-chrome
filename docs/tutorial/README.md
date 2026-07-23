# Field Guide source

<!--
CHANGED: The deployable Field Guide now has one source of truth.
WHY: The former docs/tutorial/tutorial.html copy duplicated the live Pages file and could drift.
-->

The canonical Field Guide is [`demo/public/tutorial/index.html`](../../demo/public/tutorial/index.html).

GitHub Pages serves that file at `/tutorial/`, and the deploy workflow already watches `demo/**`.
Keep tutorial HTML, CSS, JavaScript, copy, and assets in the canonical file only. This directory
exists as a stable documentation pointer; do not add a second HTML copy here.

When the guide changes, review `demo/index.html` in the same pass so its route descriptions and
entry links stay aligned.
