**Voice Character Stylization Supplemental Reference**  
*(Post-v4 Expansion for the dulcet Roadmap — v5-development-roadmap.md)*

**Status**: Supplemental reference document. Drafted after the attached `v5-development-roadmap.md` (the `dulcet` branching plan with `dsp-foundation`, `pitch-formant`, `preview-pipeline`, and `character-system`).  

This document **does not supersede** the main roadmap. It expands and vindicates scope in targeted areas where deeper stylization primitives, a shifted preview strategy, and stronger “user-as-character-actor” goals better serve the project’s flagship voice feature set. Where differences exist (especially preview approach and new primitive categories), pursue the expansion if it improves character voice quality and usability for social-media impact use cases. All changes remain fully aligned with the existing architecture, client-side constraints, no-GPU requirement, and acceptable processing windows (~10 minutes max for Reddit comment threads).

### Core Philosophy (Reaffirmed & Sharpened)
- The user’s recorded performance is always the **driver** (timing, prosody, emotion, word choice, delivery).
- Our job is **maximal entertaining stylization** via DSP primitives so the output sounds like a highly stylized fantasy/video-game/anime/V-tuber-style character voice.
- Goal: “V-tuber on steroids” — out-there, in-your-face, immediately recognizable character acting suitable for Reddit replies and short-form social impact.
- Voice/character features are the **largest and most important feature set** in the project (they are literally in the name).
- Processing can take time (one-shot preview or export); real-time live preview is **not required** and can be sacrificed for richer, more accurate auditioning of complex effects.
- Everything stays client-side, CPU/WASM/JS only, stable, intuitive, and accessible. No dedicated GPU or high-end hardware assumptions.

### Current v4 Main Branch State (for context)
- Voice effects implemented via FFmpeg `-af` graphs (`asetrate` + `aresample` + `atempo` pitch hack, basic 3-band EQ, `acompressor`, `aecho` reverb).
- Web Audio preview chain (simpler `playbackRate` + BiquadFilters + `DynamicsCompressorNode`).
- Vosk WASM for on-device transcription and subtitle burn-in (new in v4).
- Design Studio with profile persistence, voice config embedding, intensity + Turbo slider, collapsible panels, live visual + voice preview.
- Export via `ffmpeg.wasm` in offscreen document (single-pass or multi-pass for subtitles).
- Strong emphasis on privacy, client-side processing, and graceful degradation.

The `dulcet` roadmap already plans a major DSP rebuild for stylized/embellishing character voices. This supplement adds concrete primitives, a preview strategy shift, convolutional reverb, granular/textural work, and hybrid vocoder-like layers while fitting cleanly into the four-branch structure.

### Recommended Preview Strategy (Expansion of Branch 3)
**One-shot short preview** (preferred over attempting lightweight real-time live preview for complex effects).

**How it works**:
- In the Design Studio / Voice panel: Prominent “Test Character Voice” button.
- User records a short test clip (e.g., 10–15 seconds of the kind of delivery they plan to use).
- System processes the clip with the **current full effect configuration** (using the enhanced pipeline from `dsp-foundation` + new primitives).
- Result plays back immediately after processing (user waits — acceptable because it enables accurate auditioning of rich effects).
- Option to save the test clip + config as a quick “character test” inside the profile.

**Why this wins**:
- Allows full convolutional reverb, granular/textural layers, hybrid vocoder-style overlays, and complex multilayer graphs without real-time constraints.
- Much higher fidelity between preview and final export.
- Fits the character-creation workflow perfectly (users will happily wait a few seconds for a good test of their fantasy voice).
- Still keeps a lightweight “instant” mode for simple intensity or basic preset tweaks if desired (non-blocking).

Update `preview-pipeline` branch (and `preview-chain.ts` / `process-audio.ts`) to support this one-shot offline rendering path (reuse or extend the offscreen/FFmpeg worker pattern). Document where preview is now “authoritative enough” vs. export.

### Modulatable Primitives — The Heart of the Feature Set
Present these as a **polished, intuitive collection of mix-and-match building blocks**, not a full heavy design studio. Users should clearly understand “what this does to my character voice” and easily combine them.

**UI approach (for `character-system` branch)**:
- Categorized sections or accordions (Pitch & Formant, Dynamics & Clarity, Modulation & Movement, Color & Embellishment, Spatial/Reverb, Textural/Granular, Hybrid Layers).
- Each primitive has: Enable/disable toggle, 1–3 high-level intuitive sliders (e.g., “Amount”, “Character”, “Edge”, “Air”), short one-sentence tooltip explaining the fantasy/character effect.
- Simple chain/order control (drag to reorder or numbered list) + global Intensity/Turbo that scales intelligently per primitive.
- Prominent one-shot preview button.
- High-level “Expressive” macros that intelligently compose several primitives (e.g., “Cyber Oracle”, “Glitch Beast”, “Ethereal Singer”) as starting points.
- Persistence inside profiles + easy “Save as Character” flow.

**Concrete Primitive Reference** (to be implemented across the branches)

**1. Pitch & Formant (core of Branch 2, enhanced)**
- High-quality pitch shifting with independent or coupled formant control.
- Parameters: Semitones, Formant Shift/Warp, Character Amount.
- Character use: Deep monster, high elf, helium cartoon, gender-bent hero, etc.
- Modulation: Intensity scales the shift amount + any formant emphasis.

**2. Dynamics & Clarity (supporting, in dsp-foundation)**
- Gate, Compressor, Limiter, De-esser, De-click.
- Parameters: Threshold, Ratio/Strength, Makeup, “Presence”.
- Character use: Tight broadcast voice, aggressive growl, clean fantasy narration, or intentionally squashed “radio demon” effect.

**3. Modulation & Movement (new emphasis in dsp-foundation)**
- Flanger, Chorus, Phaser, Tremolo, Vibrato, subtle ring-modulation approximations.
- Parameters: Rate, Depth, Feedback/Character, Mix.
- Character use: Swirling ethereal, robotic shimmer, living mechanical, phasey ghost, vibrating creature.

**4. Color & Embellishment (dsp-foundation)**
- Saturation, Harmonic Excitement, Presence/Air, Spectral Carving (`afftfilt` expressions).
- Parameters: Warmth, Sparkle, Edge, Air Amount.
- Character use: Adds “produced” fantasy polish, metallic resonance, breathy singer, gritty warrior.

**5. Spatial / Convolutional Reverb (major new win — add to dsp-foundation + preview)**
- `ConvolverNode` (preview/offline) + FFmpeg equivalent or pre-rendered convolution for export.
- Bundle 12–20 lightweight impulse responses (small files, easy to embed or lazy-load). Suggested starter set:
  - Tight metal chamber / cyber terminal
  - Fantasy stone hall / cathedral
  - Small wooden box / resonant crate
  - Underwater / bubble
  - Large echoing cavern
  - Phone handset / walkie-talkie
  - “Ancient oracle” long tail
  - Dry close-mic + light ambience
- Parameters: IR selection (or “Character Space”), Wet/Dry, Decay Tail, Pre-delay.
- Character use: Instantly places the voice in a believable fantasy space or gives metallic/wooden timbral signature. Huge for “in your face” stylized presence.

**6. Textural / Granular (new — add to dsp-foundation)**
- Grain-based chopping, randomization, overlap, pitch-per-grain, reverse, density, size.
- Can start with FFmpeg tricks (`asetpts`, multi-tap delays, `amix`) and evolve to AudioWorklet + lightweight WASM granulator for finer control.
- Parameters: Grain Size, Density/Overlap, Randomization, Pitch Scatter, Texture Mix.
- Character use: Video-game unit voices, glitchy cyberpunk, shimmering spirit, stuttering monster, anime “power-up” vocal texture. Perfect for the “video game / anime character SFX” goal.

**7. Hybrid Layers / Vocoder-like & Synth Voicing (new — multilayer in dsp-foundation)**
- Envelope-driven or pitch-driven overlay layers mixed with the processed original.
- Techniques:
  - Extract simple envelope (RMS or better) or lightweight pitch contour from the driver recording.
  - Modulate a stylized carrier (filtered noise, oscillator bank, or secondary granular layer) with that envelope/pitch.
  - Optional second parallel processed stream (e.g., heavily effected original + clean-ish synth layer).
- Parameters: Layer Mix, Carrier Character/Timbre, Follow Strength, Harmonic Emphasis.
- Character use: Classic vocoder “robot singer”, talkbox-style, synth-pop fantasy voice, dual-voice oracle, “possessed” effect, or subtle harmonic reinforcement that makes the character voice feel richer and more produced.
- This is the closest we get to “overlaying additional voicing” while still using the user’s performance as the absolute driver.

**Multilayer & Global Mixing**
- Support parallel streams or post-mix stages so primitives can be combined creatively (e.g., granular texture on one layer + convolutional reverb on the whole + hybrid synth overlay).
- Keep graphs composable and documented so users (and future developers) can understand and extend the “recipe”.

### Integration with the dulcet Branch Plan
- **dsp-foundation**: Core home for most new primitives (conv reverb fragments, granular, hybrid layer concepts, `afftfilt` color tools, modulation family). Build the reusable, composable graph system around these stylized/character goals.
- **pitch-formant**: Enhanced with the formant control and expressive high-level parameters that feed the other primitives.
- **preview-pipeline**: Major update to support one-shot short preview rendering + full new primitive chains (including conv reverb and granular). Document fidelity tradeoffs.
- **character-system**: The user-facing power layer. Strong mix-and-match UI, custom character profile saving, high-level expressive macros that compose primitives, and the “V-tuber on steroids” presentation. This branch becomes even more central because voice/character is the flagship feature set.

After the four branches merge back to `dulcet`, do final polish on intensity curves, hints/tooltips, voice-summary display, and documentation of the stylized character philosophy.

### Success Criteria (Expanded)
- Existing presets sound better and remain compatible.
- Users can quickly create convincing, repeatable, highly stylized fantasy/video-game/anime character voices by mixing primitives.
- One-shot preview feels worthwhile and accurate.
- Convolutional reverb + granular + hybrid layers deliver the “out there in your face” entertainment value.
- The system feels like a tool for **voice acting and character portrayal** on social media rather than transparent enhancement.
- All processing stays within acceptable time windows for Reddit-style use.

### Open Items for Implementation
- Exact lightweight IR bundle (size, generation method, licensing).
- Cleanest way to express multilayer/hybrid graphs in FFmpeg while keeping them maintainable.
- Performance envelope for granular processing on 2-minute clips.
- Whether to keep any ultra-lightweight real-time preview mode alongside the one-shot test.
- How much pitch-detection or envelope analysis can stay pure JS vs. small WASM helper.

This supplemental gives you a concrete, referenceable feature set you can point to when implementing or breaking work into the existing `dulcet` branches (or adjusting them). It directly supports the character-acting, social-impact use case while respecting the engineering constraints and the roadmap structure you already have.

You can drop this into `docs/voice-stylization-supplemental.md` (or similar) and reference it from the main roadmap or `engineering-principles.md`. Let me know if you want me to generate the actual file, refine any primitive descriptions, or sketch UI text/tooltips for the mix-and-match interface.