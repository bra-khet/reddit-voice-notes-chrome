

### Overall Structure for v5 - Codename: Dulcet II

**Main Line**: `dulcet`  
**Dependent Branches** (created from `dulcet`):
1. `dulcet/dsp-foundation`
2. `dulcet/pitch-formant`
3. `dulcet/preview-pipeline`
4. `dulcet/character-system`

After all four are merged back into `dulcet`, do final polish work directly on `dulcet`.

---

### Branch 1: `dulcet/dsp-foundation`

**Purpose**: The biggest piece of architectural surgery. Rebuild the reusable DSP filter graph system for stylized, embellishing, professional character voices.

**Why a dedicated branch?** This touches `filter-graphs.ts`, `resolve-config.ts`, `types.ts`, and `presets.ts` at a foundational level. Everything else depends on it.

#### Sub-Phase 1.1: Audit & Design the New Graph System
- Review current `filter-graphs.ts` and `resolve-config.ts` on `dulcet`.
- Design the new modular fragment system (reusable, composable `-af` building blocks optimized for stylized voices).
- Define the new config shape in `types.ts`.

#### Sub-Phase 1.2: Implement Core Graph Fragments
- Build high-quality, well-documented fragments for:
  - Pitch + formant (preparatory)
  - Dynamics (gate, compressor, limiter, de-esser, de-click)
  - Creative color & embellishment (reverb, modulation, saturation, presence/air, harmonic excitement)
- Create `buildStylizedGraph()` helper.

#### Sub-Phase 1.3: Update Resolution & Modulation Logic
- Refactor `resolve-config.ts` to use the new system.
- Implement smart, non-linear intensity + Turbo scaling tailored to stylized/character use cases.
- Update `presets.ts` with refreshed base graphs for existing presets.

**Success Criteria for this branch**:
- All existing presets still work and sound better.
- New modular graph system is in place and documented.
- Intensity modulation feels good for character voices.

**Merge back to `dulcet`** before starting the next branch.

---

### Branch 2: `dulcet/pitch-formant`

**Purpose**: Deliver high-quality, natural-feeling pitch and formant shifting — one of the most powerful tools for stylized character voices.

**Why a dedicated branch?** This is a focused, high-value addition that benefits from being developed against the new foundation from Branch 1, then reviewed in isolation.

#### Sub-Phase 2.1: High-Quality Pitch + Formant Graphs
- Implement first-class pitch shifting with good formant handling (Rubber Band where possible, or best DSP equivalent).
- Create dedicated graph fragments and parameter mappings.

#### Sub-Phase 2.2: Expressive Controls
- Add useful high-level parameters (e.g., "Character Amount", separate pitch vs formant influence).
- Wire intensity modulation to these parameters intelligently.

#### Sub-Phase 2.3: Integration & Testing
- Update relevant presets to use the new system.
- Test extensively in both preview and export.
- Ensure stylized voices remain musical and professional even at extreme settings.

**Success Criteria**:
- Pitch-based character transformation sounds significantly more natural and versatile than before.
- Works cleanly with the new DSP foundation.

**Merge back to `dulcet`**.

---

### Branch 3: `dulcet/preview-pipeline`

**Purpose**: Upgrade the real-time Web Audio preview so it can properly audition the new stylized DSP effects.

**Why a dedicated branch?** Preview changes can be risky for user experience. Keeping them somewhat isolated makes it easier to tune latency and fidelity without blocking other work.

#### Sub-Phase 3.1: Extend Preview Chain
- Update `preview-chain.ts` and `process-audio.ts` to consume the new graph system from Branch 1.
- Support the new pitch + formant capabilities in preview where feasible.

#### Sub-Phase 3.2: Performance & Fidelity Tuning
- Optimize for low latency with richer chains.
- Decide and document where preview is "close enough" vs where export is authoritative.
- Maintain the single master preview pattern.

#### Sub-Phase 3.3: Consistency & Edge Cases
- Ensure preview behavior matches export behavior as closely as practical.
- Handle cases where complex stylized graphs can't be fully reproduced in real-time.

**Success Criteria**:
- Users can quickly and enjoyably audition stylized character effects in the Design Studio.
- Preview remains responsive.

**Merge back to `dulcet`**.

---

### Branch 4: `dulcet/character-system`

**Purpose**: Deliver the expressive Custom mode and new stylized presets that let users create their own character voices.

**Why a dedicated branch?** This is the "user-facing power" layer. It depends on everything built in the previous three branches.

#### Sub-Phase 4.1: Powerful Custom Mode
- Allow users to compose from the reusable graph fragments.
- Add high-level expressive controls ("Character Amount", "Presence", "Edge", "Air", etc.).
- Improve persistence and the voice summary display.

#### Sub-Phase 4.2: New Stylized Presets + Supporting Cleanup
- Create several new character-oriented presets using the full new system.
- Integrate targeted cleanup tools (de-essing, de-clicking, musical dynamics) that support stylized output without fighting it.

#### Sub-Phase 4.3: Polish & Documentation
- Refine intensity curves for the new expressive parameters.
- Update in-app hints and `voice-summary.ts`.
- Add internal documentation explaining the stylized/embellishing design philosophy.

**Success Criteria**:
- Users can create and save sophisticated, repeatable stylized character voices.
- The system feels like a tool for voice acting and entertainment rather than transparent recording enhancement.

**Merge back to `dulcet`**.

