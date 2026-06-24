# Design Studio — Feature Set Scaffold (Visual + Logical Tree)

**Purpose**: Living, text-based visual scaffold of the Design Studio feature set.  
It shows **what settings exist**, **how they nest**, and **why they belong together** (logical function + visual result).  
Use this to keep UI design, code organization, and mental model in sync as v4 evolves.

**Status**: Aligned to canonical `docs/design-studio.md` (v3.7.0 / `eloquent`, 2026-06-23).  
**Shipped layout (v3.7)**: Hero 16:9 preview + profile/status cluster + **1×4 status card strip** → sub-panels. See `docs/release-notes-v3.7.0.md`.  
**Assets**: `public/assets/design-studio-v4/` (runtime); specs in `vector-ui-assets-spec.md`.
**Canonical reference** (read-only): `C:\Users\robin\claude-code\reddit-voice-notes-chrome\docs\design-studio.md` — semantic framework, controls inventory, and architecture. Update this scaffold to stay copacetic with it.

---

## How to Analyze the Repo (Short Guide)

When you (or future agents) need to update this scaffold or design new panels:

1. **Start here (UI shell)**  
   - `entrypoints/design-studio/index.html` + `main.ts` (boots prefs, mounts studio)  
   - `src/ui/design-studio/mount-clip-studio.ts` — the single source of the current DOM tree. Look for:
     - `.studio__profile-bar`
     - `renderPreviewBlock('primary')`
     - `<details class="studio__panel" data-studio-panel="...">` for the four sections
     - Calls to `render*ControlFields()` and `mount*Controls()`

2. **Section implementations** (`src/ui/design-studio/`)
   - `preview-block.ts` — the 16:9 canvas host
   - `studio-section-summaries.ts` — collapsed state visuals (swatches, badges, chips)
   - `color-picker.ts` + `radial-knob.ts` — custom HSV controls
   - `background-layout-controls.ts` — scale + 3×3 position grid
   - `effect-controls.ts`, `subtitle-controls.ts`, `voice-controls.ts`, `subtitle-segment-editor.ts`
   - `studio-save-pathways.ts` + `studio-exit.ts` — profile/style dirty + save discipline

3. **Data models (the real nesting truth)**
   - `src/settings/user-preferences.ts`
     - `UserPreferencesV1.appearance: AppearancePreferences`
     - `voiceEffect: VoiceEffectConfig`
     - `transcriptConfig: TranscriptConfig` (style + enabled only for profiles; result text is separate)
   - `src/settings/clip-profiles.ts` — `ClipProfile` (snapshots appearance + voice + transcript **style**; text/timing live in session IDB `rvnSessionTranscript`)
   - `src/theme/design-overrides.ts` — `DesignOverrides` (barColor + effects)
   - `src/transcription/types.ts` — `TranscriptConfig` + rich `SubtitleStyleConfig` (textColor, backdrop, shadow, glow with mode/colorSource, outline, etc.)
   - `src/voice/types.ts` — `VoiceEffectConfig` (preset + intensity + optional detailed bands)

4. **Visual composition & rendering (why nesting matters)**
   - `src/theme/` (types.ts, presets.ts, background-layout.ts, design-overrides.ts)
   - `src/recorder/waveform.ts` — canvas draw order (bg → bars → effects)
   - `src/ffmpeg/subtitle-burnin.ts` — subtitles are **post-base** burn-in (never drawn in the live canvas for export)
   - `src/transcription/subtitle-preview.ts` — studio preview overlay only

5. **Profile & persistence rules**
   - A profile can capture: theme + alignment + personal bg layout + customStyle/designOverrides + voiceEffect + transcriptConfig **style + toggle** only.
   - Transcript **text and timing** live in session `rvnSessionTranscript` IDB (not in profile snapshot or exit guard for profile dirty).
   - Custom styles live separately (colors + effects only).
   - Subtitles have an atomic on/off flag (`rvn.subtitles.enabled`) outside the main prefs blob for race safety.
   - See canonical §3.5 for dirty-state taxonomy.

6. **Update this file when**
   - New top-level section is added
   - A sub-setting moves (e.g. effects promoted or demoted)
   - Subtitle style fields change (textColor, shadow, glow mode/color, outline, etc.)
   - New save granularity or IDB vs prefs distinction appears

**Canonical reference**: The authoritative behavior, controls inventory, module maps, and semantic contracts live in the main repo's `docs/design-studio.md` (read-only for this workspace). Use it to verify details; this scaffold stays as the visual tree for asset organization and redesign decisions. Cross-check after any polish in the main repo.

Keep the trees below as the single source of truth for “what belongs inside what”.

---

## 1. Logical Composition Tree (Final Video Layers)

This is **how the pixels are built**. UI should respect this order visually and logically.

```
Design Studio (what user customizes)
│
├── 1. BACKGROUND LAYER (bottom)
│   ├── Theme (bundled preset)
│   │   ├── Colors (derived bg from barColor or preset)
│   │   └── Background type (solid | gradient | image | bokeh)
│   └── Personal Background (optional, overrides)
│       ├── Image (IndexedDB blob ref)
│       ├── Scale Mode (fit | fill)
│       └── Position (9-point: top-left … bottom-right)
│
├── 2. BARS + EFFECTS LAYER
│   ├── Bar Style / Waveform
│   │   ├── Clip Style (preset theme or Custom Style)
│   │   │   └── Custom Colors (DesignOverrides)
│   │   │       ├── Bar Color (primary — drives glow + bg too)
│   │   │       ├── Glow Color (derived or explicit)
│   │   │       └── Effects
│   │   │           ├── Background Flair (none | bokeh | sparkle)
│   │   │           └── Bar Glow (default | boosted)
│   │   └── Bar Alignment (top | center-mirrored | bottom)
│   └── Live Preview always reflects this stack
│
└── 3. SUBTITLES LAYER (topmost — baked after base.mp4)
    ├── Transcription (result segments from Vosk or manual) — session IDB only
    └── Subtitle Style (in prefs / profile snapshot)
        ├── Enabled (global on/off for this profile + atomic flag)
        ├── Position (top | center | bottom)
        ├── Font Size
        ├── Text Color (white | black)
        ├── Backdrop Plate
        │   ├── Enabled
        │   └── Opacity
        ├── Drop Shadow (offset dark copy)
        └── Glow
            ├── Enabled (theme glow)
            ├── Mode (halo | offset)
            └── Color Source (theme | black | white)
        └── Outline (stroke)
```

**Note**: Voice effects are audio-only (no visual layer in compositing). They are applied in transcode but do not affect the bars/background canvas.

**Rule**: Visual layout in the UI should mirror this bottom-to-top order when possible (Background panel lowest, Subtitles highest or rightmost in a grid). Panel order is semantic per the canonical: bottom → top compositing in final MP4 is **background → bars → subtitles**. Voice is audio-only (no canvas layer).

---

## 2. User Customization Hierarchy (Recommended Logical Nesting)

This is **what the user thinks about** while looking at the preview. Group controls so related decisions feel together.

```
Design Studio
│
├── PROFILE (meta / container — always at top)
│   ├── Select active profile (or Custom/manual)
│   ├── Save / Update / Clone (Save to new) / Delete
│   └── Note: A profile owns one snapshot of everything below
│
├── LIVE PREVIEW (16:9 — always visible, top or dominant)
│   └── Single source of truth. Updates live on any change.
│
└── CUSTOMIZATION SECTIONS (the grid panels)
    │
    ├── BAR STYLE  (affects the moving graphic directly)
    │   ├── Clip Style
    │   │   ├── Preset styles (bundled)
    │   │   └── Custom Style (saved color sets; "Custom" or saved style shows sub-panel)
    │   │       ├── Save / Update / Clone style / Delete
    │   │       └── Live Color Editor
    │   │           ├── Hue Wheel (full ring)
    │   │           ├── Saturation Knob
    │   │           ├── Value / Brightness Knob
    │   │           └── HEX input + live swatch
    │   ├── Bar Alignment (Top / Center / Bottom) — visual 3-bar badge in summary
    │   └── Effects (sub-group because they modulate the bar layer)
    │       ├── Bar Glow (default vs boosted)
    │       └── Background Flair (none / bokeh / sparkle)
    │
    ├── BACKGROUND
    │   ├── Theme Background (read-only when personal present)
    │   ├── Personal Background
    │   │   ├── Upload / Choose from library / Delete
    │   │   └── (WYSIWYG: appears in preview immediately)
    │   └── Layout (only relevant with personal bg)
    │       ├── Scale (Fit | Fill)
    │       └── Position Grid (3×3 clickable)
    │           (Summary example: "Personal · Fit · TL" or "Theme background")
    │
    ├── VOICE
    │   ├── Enable Voice Effects
    │   ├── Preset (Deeper | Higher | Robot | Whisper | Slight mask | Custom)
    │   ├── Intensity (0–10 slider)
    │   │   └── Turbo (forces 12, bypasses slider)
    │   └── Preview Playback (plays last recording through effects)
    │       (Pitch radial knob under Custom switches preset to Custom; other EQ/dynamics/reverb for advanced)
    │
    └── SUBTITLES  (topmost layer — separate from visual bars)
        ├── Enable Subtitles (transcription + burn-in)
        ├── Transcript (session IDB — text/timing only; NOT snapshotted in profiles)
        │   ├── Auto result (from last record) or manual
        │   └── Segment Editor
        │       ├── Time start/end (nudgeable)
        │       ├── Text
        │       ├── Per-cue play button
        │       ├── Add / Remove segments
        │       └── Modal guards + Confirm & save (Apply to preview)
        └── Style (prefs + profile snapshot)
            (See detailed list in Logical Composition Tree above)
            └── Bake subtitles into MP4 (separate from live preview)
            ├── Position (Top / Center / Bottom)
            ├── Font Size (14–36)
            ├── Text Color (white | black)
            ├── Backdrop Plate (toggle + opacity)
            ├── Drop Shadow (toggle)
            └── Glow (toggle + style: halo/offset, color: theme/black/white)
                (Outline available in model)
```

---

## 3. Current Implementation Mapping (v3.1 + v4)

(Use this column when deciding what to move in the redesign)

| Logical Section     | Current UI Location          | Key Code Files                              | Notes |
|---------------------|------------------------------|---------------------------------------------|-------|
| Profile             | Top bar (always)             | mount-clip-studio, studio-save-pathways     | Owns everything |
| Live Preview        | Directly under profile bar   | preview-block.ts, renderThemePreview        | Only one now |
| Bar Style + Colors  | "Bar style" panel            | mount... + color-picker + effect-controls   | Contains custom style editor |
| Bar Alignment       | Same "Bar style" panel       | mount-clip-studio                           | Visual badge lives in summary |
| Effects             | Subsection inside Bar style  | effect-controls.ts                          | Flair + glow |
| Background + Layout | "Background" panel           | background-layout-controls + personal-bg    | Personal only shows layout when present |
| Voice               | "Voice" panel                | voice-controls.ts + preview-chain           | Uses last recording |
| Subtitles           | "Subtitles" panel (last)     | subtitle-controls + subtitle-segment-editor | Transcript (session) + full Style (position, font, color, backdrop, shadow, glow, outline) + Bake + Clear |
| Save discipline     | Buttons per section + global Done | studio-*.ts                              | Must stay consistent |

**Current pain points for redesign**:
- Everything is vertically stacked (accordion).
- Color editing is powerful but deeply nested inside one panel.
- Subtitles style settings (many: color, backdrop, shadow, glow+options) are siblings with the transcript segment editor (they affect different things: live overlay style vs. text content in session IDB).
- Recent polish added detailed glow/shadow/outline + modal guards for segment editor.

---

## 4. Design Principles for Nesting & Visual Layout

1. **Preview is sacred** — user is always looking at the finished result. Sections exist to edit one concern while watching the whole.
2. **Group by visual impact layer** (see Composition Tree).
3. **Group by user decision cluster**:
   - "How do the bars look and move?" → Bar Style + Alignment + Effects
   - "What is behind the bars?" → Background
   - "How does my voice sound?" → Voice (previewable without re-recording)
   - "What do the words say and how are they written?" → Subtitles (text vs style can be sub-grouped)
4. **Custom styles are a first-class thing** but scoped to color + effects only.
5. **Profiles are the unit of reuse** — a profile can contain choices from every section.
6. **Mobile / narrow**: Each panel must be able to stand alone and optionally surface its own mini-preview when focused.
7. **Text-based scaffold wins** — update the trees here before moving code or drawing new panel assets.

---

## 5. Suggested Grid Layout Mapping (for v4 redesign)

Proposed 2×2 or 3×2 (desktop), vertical stack on mobile:

```
[        LIVE PREVIEW (full width, 16:9)        ]

[ Bar Style ]     [ Background ]
[  Colors    ]    [  Personal  ]
[ Alignment  ]    [   Layout   ]
[  Effects   ]

[ Voice     ]     [ Subtitles  ]
[ Presets   ]     [ Transcript ]
[ Intensity ]     [   Style    ]
```

Or tighter 3×2:

- Bar Style (big — contains colors + alignment + effects)
- Background
- Voice
- Subtitles
(Leave two cells for future: e.g. "Text Effects", "Advanced", or profile actions)

Each cell becomes a **panel asset** (frame, header, contained controls).

---

## Maintenance Notes

- When adding a new control (e.g. subtitle text color picker):
  1. Add it under the correct subtree above.
  2. Note its data type location.
  3. Decide: does it live in its own panel or as a subsection?
  4. Update both the Logical and Customization trees.
- After any major refactor of mount-clip-studio.ts or the types, re-verify this doc.
- Keep the "How to Analyze" section short but accurate — it is the onboarding for the next person.

---

**Next steps for asset work** (when ready):
- User provides raster sketches in `raster-sketches/`
- Create reusable SVG panel primitives in `vector-assets/` (frame, header bar, subsection divider, 3×3 grid tile, knob face, etc.)
- Make sure every asset can be used at different scales and in both grid and stacked layouts.

This file is the shared visualization tool. Update it often. It should feel as clear and organized as we want the actual interface to be.
