/**
 * Dulcet II (v5 / Branch 4) — Custom voice composer.
 *
 * A standalone, *controlled* component that renders and edits a StylizedGraph:
 * the seven primitive categories as accordions, a curated core of high-impact
 * effects with an "Advanced" reveal for the rest, each effect a toggle + a few
 * high-level sliders + a one-line tooltip, plus "Blank slate" (clear) and
 * "Reset order" (canonical re-sort) actions.
 *
 * Graph-in / graph-out only: every edit calls `onChange(nextGraph)`. The Studio
 * panel (voice-controls.ts) owns persistence and the seed-then-tweak wiring, so
 * this module stays pure-UI and unit-mountable (harness) in isolation.
 *
 * @see docs/v5-development-roadmap-supplemental.md (§"UI approach")
 */

import {
  createFragment,
  FRAGMENT_DEFS,
  FRAGMENT_GAIN_MAX,
  FRAGMENT_GAIN_MIN,
  FRAGMENT_KINDS,
  IR_SPACES,
  normalizeStylizedGraph,
  orderFragmentsCanonically,
  type AnyFragment,
  type FragmentCategory,
  type FragmentKind,
  type StylizedGraph,
} from '@/src/voice/dsp';
import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';

export interface VoiceComposerHandle {
  /** Replace the edited graph (e.g. when the panel seeds from a character). */
  setGraph(graph: StylizedGraph): void;
  /** Current edited graph (normalized clone). */
  getGraph(): StylizedGraph;
  dispose(): void;
}

export interface VoiceComposerOptions {
  initialGraph: StylizedGraph;
  /** Fired on every structural or parameter edit with a normalized clone. */
  onChange(graph: StylizedGraph): void;
}

/** Display order + labels for the seven primitive families (supplemental §"UI approach"). */
const CATEGORY_ORDER: ReadonlyArray<{ id: FragmentCategory; label: string }> = [
  { id: 'pitch-formant', label: 'Pitch & formant' },
  { id: 'dynamics', label: 'Dynamics & clarity' },
  { id: 'modulation', label: 'Modulation & movement' },
  { id: 'color', label: 'Color & embellishment' },
  { id: 'spatial', label: 'Spatial / reverb' },
  { id: 'textural', label: 'Textural / granular' },
  { id: 'hybrid', label: 'Hybrid layers' },
];

/** Curated "core" — the highest-impact effects shown before the Advanced reveal. */
const CORE_KINDS: ReadonlySet<FragmentKind> = new Set<FragmentKind>([
  'pitchFormant',
  'compressor',
  'saturation',
  'presenceAir',
  'ringMod',
  'convReverb',
  'granular',
  'hybridLayer',
]);

/** Friendly per-parameter labels (keys come straight off the registry defaults). */
const PARAM_LABELS: Record<string, string> = {
  semitones: 'Pitch',
  formantShift: 'Formant',
  character: 'Character',
  amount: 'Amount',
  makeup: 'Makeup',
  strength: 'Strength',
  rate: 'Rate',
  depth: 'Depth',
  mix: 'Mix',
  frequency: 'Frequency',
  warmth: 'Warmth',
  drive: 'Drive',
  edge: 'Edge',
  sparkle: 'Sparkle',
  presence: 'Presence',
  air: 'Air',
  lowGain: 'Low',
  midGain: 'Mid',
  highGain: 'High',
  decay: 'Decay',
  preDelay: 'Pre-delay',
  grainSize: 'Grain size',
  density: 'Density',
  randomization: 'Randomize',
  pitchScatter: 'Pitch scatter',
  layerMix: 'Layer mix',
  followStrength: 'Follow',
  harmonicEmphasis: 'Harmonics',
  space: 'Space',
  carrier: 'Carrier',
};

const SPACE_LABELS: Record<string, string> = {
  'fantasy-hall': 'Fantasy hall',
  'cyber-chamber': 'Cyber chamber',
  cavern: 'Cavern',
  'small-box': 'Small box',
  phone: 'Phone / radio',
  oracle: 'Ancient oracle',
};

const CARRIER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'noise', label: 'Noise' },
  { value: 'oscillator', label: 'Oscillator' },
  { value: 'osc-bank', label: 'Osc bank' },
  { value: 'granular', label: 'Granular' },
];

type ControlSpec =
  | { type: 'range'; key: string; label: string; min: number; max: number; step: number }
  | { type: 'select'; key: string; label: string; options: ReadonlyArray<{ value: string; label: string }> };

const SPACE_OPTIONS = Object.keys(IR_SPACES).map((id) => ({
  value: id,
  label: SPACE_LABELS[id] ?? id,
}));

/** Derive the 1–3 high-level controls for a fragment kind from its registry defaults. */
function controlSpecsFor(kind: FragmentKind): ControlSpec[] {
  const defaults = FRAGMENT_DEFS[kind].defaults as unknown as Record<string, unknown>;
  const specs: ControlSpec[] = [];
  for (const [key, defVal] of Object.entries(defaults)) {
    if (key === 'space') {
      specs.push({ type: 'select', key, label: PARAM_LABELS[key] ?? key, options: SPACE_OPTIONS });
      continue;
    }
    if (key === 'carrier') {
      specs.push({ type: 'select', key, label: PARAM_LABELS[key] ?? key, options: CARRIER_OPTIONS });
      continue;
    }
    if (typeof defVal !== 'number') continue;
    const label = PARAM_LABELS[key] ?? key;
    if (key === 'semitones' || key === 'formantShift' || key.endsWith('Gain')) {
      specs.push({ type: 'range', key, label, min: -12, max: 12, step: 1 });
    } else if (key === 'frequency') {
      specs.push({ type: 'range', key, label, min: 20, max: 2000, step: 10 });
    } else {
      specs.push({ type: 'range', key, label, min: 0, max: 100, step: 5 });
    }
  }
  return specs;
}

function cloneGraph(graph: StylizedGraph): StylizedGraph {
  return JSON.parse(JSON.stringify(graph)) as StylizedGraph;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtRange(spec: Extract<ControlSpec, { type: 'range' }>, value: number): string {
  if (spec.min < 0 && value > 0) return `+${value}`;
  return String(value);
}

export function mountVoiceComposer(
  host: HTMLElement,
  options: VoiceComposerOptions,
): VoiceComposerHandle {
  let graph = normalizeStylizedGraph(options.initialGraph);
  let showAdvanced = false;
  // "Fine-tune" disclosure: when on, each active primitive shows a per-effect
  // strength dial (the per-primitive intensity curve) to the left of its name.
  let showFineTune = false;
  // Default-expand any category that already carries an effect; the rest stay tidy.
  const expanded = new Set<FragmentCategory>();
  for (const fragment of graph.fragments) {
    expanded.add(FRAGMENT_DEFS[fragment.kind].category);
  }
  if (expanded.size === 0) expanded.add('pitch-formant');

  host.classList.add('voice-composer');

  function findFragment(kind: FragmentKind): AnyFragment | undefined {
    return graph.fragments.find((fragment) => fragment.kind === kind);
  }

  function kindsForCategory(category: FragmentCategory): FragmentKind[] {
    // Show a kind when it is core, when Advanced is revealed, or when it is
    // already present (so a seeded preset's advanced effects stay editable).
    return FRAGMENT_KINDS.filter((kind) => {
      if (FRAGMENT_DEFS[kind].category !== category) return false;
      return CORE_KINDS.has(kind) || showAdvanced || Boolean(findFragment(kind));
    });
  }

  function enabledCount(category: FragmentCategory): number {
    return graph.fragments.filter(
      (fragment) => FRAGMENT_DEFS[fragment.kind].category === category && fragment.enabled,
    ).length;
  }

  function emit(): void {
    options.onChange(cloneGraph(graph));
  }

  function renderControls(fragment: AnyFragment): string {
    const params = fragment.params as unknown as Record<string, unknown>;
    const rows = controlSpecsFor(fragment.kind).map((spec) => {
      if (spec.type === 'select') {
        const current = String(params[spec.key] ?? '');
        const opts = spec.options
          .map(
            (opt) =>
              `<option value="${escapeAttr(opt.value)}"${opt.value === current ? ' selected' : ''}>${opt.label}</option>`,
          )
          .join('');
        return `
          <div class="voice-composer__ctrl">
            <span class="voice-composer__ctrl-label">${spec.label}</span>
            <select class="popup__select voice-composer__select" data-action="set-param"
              data-kind="${fragment.kind}" data-key="${spec.key}"
              aria-label="${escapeAttr(`${FRAGMENT_DEFS[fragment.kind].label} ${spec.label}`)}">${opts}</select>
          </div>`;
      }
      const value = Number(params[spec.key] ?? 0);
      // NOTE: a <div> wrapper (not <label>) — a wrapping label forwarded clicks on
      // the readout/label text to the range input and made the slider jump
      // ("cursor capture"). The input carries its own aria-label.
      return `
        <div class="voice-composer__ctrl">
          <span class="voice-composer__ctrl-label">${spec.label}</span>
          <input class="popup__range voice-composer__range" type="range"
            min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}"
            data-action="set-param" data-kind="${fragment.kind}" data-key="${spec.key}"
            aria-label="${escapeAttr(`${FRAGMENT_DEFS[fragment.kind].label} ${spec.label}`)}" />
          <span class="voice-composer__ctrl-value" data-value-for="${fragment.kind}.${spec.key}">${fmtRange(spec, value)}</span>
        </div>`;
    });
    return rows.join('');
  }

  /**
   * Per-primitive Fine-tune dial — a themed mini-knob (value inside) flanked by
   * up/down chevron steppers, sitting to the LEFT of the effect name. Only shown
   * for an *enabled* fragment while Fine-tune mode is on.
   */
  function renderGainStepper(fragment: AnyFragment): string {
    const label = FRAGMENT_DEFS[fragment.kind].label;
    const knobUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.knobs.mini);
    const upUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.chevronUp16);
    const downUrl = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.chevronDown16);
    return `
      <span class="voice-composer__gain" title="Fine-tune — ${escapeAttr(label)} strength (0–${FRAGMENT_GAIN_MAX})">
        <span class="voice-composer__gain-knob" style="background-image:url('${knobUrl}')">
          <span class="voice-composer__gain-val" data-gain-for="${fragment.kind}">${fragment.gain}</span>
        </span>
        <span class="voice-composer__gain-steps">
          <button type="button" class="voice-composer__gain-step" data-action="gain-up" data-kind="${fragment.kind}"
            aria-label="Increase ${escapeAttr(label)} strength">
            <img src="${upUrl}" alt="" width="11" height="11" />
          </button>
          <button type="button" class="voice-composer__gain-step" data-action="gain-down" data-kind="${fragment.kind}"
            aria-label="Decrease ${escapeAttr(label)} strength">
            <img src="${downUrl}" alt="" width="11" height="11" />
          </button>
        </span>
      </span>`;
  }

  function renderFragmentRow(kind: FragmentKind): string {
    const def = FRAGMENT_DEFS[kind];
    const fragment = findFragment(kind);
    const on = Boolean(fragment?.enabled);
    const isAdvanced = !CORE_KINDS.has(kind);
    const gainStepper = showFineTune && fragment ? renderGainStepper(fragment) : '';
    return `
      <div class="voice-composer__frag${on ? ' is-on' : ''}${gainStepper ? ' has-gain' : ''}">
        <div class="voice-composer__frag-head">
          ${gainStepper}
          <label class="voice-composer__frag-toggle">
            <input class="popup__toggle-input" type="checkbox" data-action="toggle-frag"
              data-kind="${kind}"${on ? ' checked' : ''} aria-label="Enable ${escapeAttr(def.label)}" />
            <span class="voice-composer__frag-name">${def.label}${isAdvanced ? '<span class="voice-composer__adv-tag">adv</span>' : ''}</span>
          </label>
          <span class="voice-composer__frag-info" title="${escapeAttr(def.blurb)}" aria-hidden="true">?</span>
        </div>
        ${fragment ? `<div class="voice-composer__frag-body">${renderControls(fragment)}</div>` : ''}
      </div>`;
  }

  function renderCategory(category: FragmentCategory, label: string): string {
    const kinds = kindsForCategory(category);
    if (kinds.length === 0) return '';
    const isOpen = expanded.has(category);
    const count = enabledCount(category);
    const badge =
      count > 0
        ? `<span class="voice-composer__count is-on">${count} on</span>`
        : `<span class="voice-composer__count">off</span>`;
    const body = isOpen
      ? `<div class="voice-composer__cat-body">${kinds.map(renderFragmentRow).join('')}</div>`
      : '';
    return `
      <div class="voice-composer__cat${isOpen ? ' is-open' : ''}">
        <button type="button" class="voice-composer__cat-head" data-action="toggle-cat" data-cat="${category}"
          aria-expanded="${isOpen ? 'true' : 'false'}">
          <span class="voice-composer__chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="voice-composer__cat-label">${label}</span>
          ${badge}
        </button>
        ${body}
      </div>`;
  }

  function render(): void {
    const cats = CATEGORY_ORDER.map((entry) => renderCategory(entry.id, entry.label)).join('');
    host.innerHTML = `
      <div class="voice-composer__toolbar">
        <span class="voice-composer__toolbar-title">Make it yours</span>
        <div class="voice-composer__toolbar-actions">
          <button type="button" class="voice-composer__link" data-action="reset-order"
            title="Restore the recommended effect order">Reset order</button>
          <button type="button" class="voice-composer__link voice-composer__link--blank" data-action="blank-slate"
            title="Start from nothing — clear every effect for a blank slate">Blank slate</button>
        </div>
      </div>
      <label class="voice-composer__advanced">
        <input class="popup__toggle-input" type="checkbox" data-action="toggle-advanced"${showAdvanced ? ' checked' : ''} />
        <span>Show advanced effects</span>
      </label>
      <label class="voice-composer__advanced voice-composer__advanced--finetune">
        <input class="popup__toggle-input" type="checkbox" data-action="toggle-finetune"${showFineTune ? ' checked' : ''} />
        <span>Fine-tune — per-effect strength dials</span>
      </label>
      <div class="voice-composer__cats">${cats}</div>`;
  }

  function onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle-cat') {
      const cat = target.dataset.cat as FragmentCategory;
      if (expanded.has(cat)) expanded.delete(cat);
      else expanded.add(cat);
      render();
    } else if (action === 'reset-order') {
      graph = { ...graph, fragments: orderFragmentsCanonically(graph.fragments) };
      render();
      emit();
    } else if (action === 'blank-slate') {
      graph = { ...graph, fragments: [] };
      render();
      emit();
    } else if (action === 'gain-up') {
      adjustGain(target.dataset.kind as FragmentKind, +1);
    } else if (action === 'gain-down') {
      adjustGain(target.dataset.kind as FragmentKind, -1);
    }
  }

  /** Nudge a fragment's Fine-tune gain by ±1 (clamped); update the readout in place. */
  function adjustGain(kind: FragmentKind, delta: number): void {
    const fragment = findFragment(kind);
    if (!fragment) return;
    const next = Math.max(FRAGMENT_GAIN_MIN, Math.min(FRAGMENT_GAIN_MAX, fragment.gain + delta));
    if (next === fragment.gain) return;
    fragment.gain = next;
    const readout = host.querySelector<HTMLElement>(`[data-gain-for="${kind}"]`);
    if (readout) readout.textContent = String(next);
    emit();
  }

  function onChangeEvent(event: Event): void {
    const target = event.target as HTMLElement;
    const action = (target as HTMLElement).dataset?.action;
    if (action === 'toggle-advanced') {
      showAdvanced = (target as HTMLInputElement).checked;
      render();
      return;
    }
    if (action === 'toggle-finetune') {
      showFineTune = (target as HTMLInputElement).checked;
      render();
      return;
    }
    if (action === 'toggle-frag') {
      const kind = (target as HTMLElement).dataset.kind as FragmentKind;
      const checked = (target as HTMLInputElement).checked;
      if (checked) {
        if (!findFragment(kind)) {
          // Insert in canonical position so a fresh effect lands sensibly in the chain.
          graph = {
            ...graph,
            fragments: orderFragmentsCanonically([
              ...graph.fragments,
              createFragment(kind) as AnyFragment,
            ]),
          };
        }
      } else {
        graph = { ...graph, fragments: graph.fragments.filter((f) => f.kind !== kind) };
      }
      // Keep the touched category open so the new controls are visible.
      expanded.add(FRAGMENT_DEFS[kind].category);
      render();
      emit();
      return;
    }
    if (action === 'set-param' && target instanceof HTMLSelectElement) {
      applyParam(target.dataset.kind as FragmentKind, target.dataset.key as string, target.value);
      emit();
    }
  }

  function onInput(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.dataset?.action !== 'set-param' || !(target instanceof HTMLInputElement)) return;
    const kind = target.dataset.kind as FragmentKind;
    const key = target.dataset.key as string;
    const value = Number(target.value);
    applyParam(kind, key, value);
    const readout = host.querySelector<HTMLElement>(`[data-value-for="${kind}.${key}"]`);
    if (readout) readout.textContent = value > 0 && Number(target.min) < 0 ? `+${value}` : String(value);
    emit();
  }

  function applyParam(kind: FragmentKind, key: string, value: number | string): void {
    const fragment = findFragment(kind);
    if (!fragment) return;
    (fragment.params as unknown as Record<string, unknown>)[key] = value;
  }

  host.addEventListener('click', onClick);
  host.addEventListener('change', onChangeEvent);
  host.addEventListener('input', onInput);
  render();

  return {
    setGraph(next: StylizedGraph) {
      graph = normalizeStylizedGraph(next);
      expanded.clear();
      for (const fragment of graph.fragments) expanded.add(FRAGMENT_DEFS[fragment.kind].category);
      if (expanded.size === 0) expanded.add('pitch-formant');
      render();
    },
    getGraph() {
      return cloneGraph(graph);
    },
    dispose() {
      host.removeEventListener('click', onClick);
      host.removeEventListener('change', onChangeEvent);
      host.removeEventListener('input', onInput);
      host.innerHTML = '';
      host.classList.remove('voice-composer');
    },
  };
}
