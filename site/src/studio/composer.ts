/**
 * Static Voice Studio — Custom voice composer.
 *
 * A *controlled* StylizedGraph editor: the seven primitive categories as
 * accordions, a curated "core" of high-impact effects with an "Advanced" reveal
 * for the rest, each effect a toggle + 1–3 high-level controls + a tooltip, plus
 * "Blank slate" and "Reset order". Graph-in / graph-out: every edit calls
 * `onChange(nextGraph)`.
 *
 * This mirrors the extension's `src/ui/design-studio/voice-composer.ts` UX and
 * behaviour, but uses native (keyboard-operable) <input type="range"> / <select>
 * controls instead of the extension's custom physical-slider component — so the
 * underlying StylizedGraph stays byte-identical while the widget is simpler and
 * accessible by default.
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

export interface ComposerHandle {
  /** Replace the edited graph (e.g. when the panel seeds from a character chip). */
  setGraph(graph: StylizedGraph): void;
  /** Current edited graph (normalized clone). */
  getGraph(): StylizedGraph;
  dispose(): void;
}

export interface ComposerOptions {
  initialGraph: StylizedGraph;
  /** Fired on every structural or parameter edit with a normalized clone. */
  onChange(graph: StylizedGraph): void;
}

/** Display order + labels for the seven primitive families. */
const CATEGORY_ORDER: ReadonlyArray<{ id: FragmentCategory; label: string }> = [
  { id: 'pitch-formant', label: 'Pitch & formant' },
  { id: 'dynamics', label: 'Dynamics & clarity' },
  { id: 'modulation', label: 'Modulation & movement' },
  { id: 'color', label: 'Color & embellishment' },
  { id: 'spatial', label: 'Spatial / reverb' },
  { id: 'textural', label: 'Textural / granular' },
  { id: 'hybrid', label: 'Hybrid layers' },
];

/** Curated "core" — highest-impact effects shown before the Advanced reveal. */
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
  | {
      type: 'select';
      key: string;
      label: string;
      options: ReadonlyArray<{ value: string; label: string }>;
    };

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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtRange(spec: Extract<ControlSpec, { type: 'range' }>, value: number): string {
  if (spec.min < 0 && value > 0) return `+${value}`;
  return String(value);
}

export function mountComposer(host: HTMLElement, options: ComposerOptions): ComposerHandle {
  let graph = normalizeStylizedGraph(options.initialGraph);
  let showAdvanced = false;
  let showFineTune = false;
  const expanded = new Set<FragmentCategory>();
  for (const fragment of graph.fragments) expanded.add(FRAGMENT_DEFS[fragment.kind].category);
  if (expanded.size === 0) expanded.add('pitch-formant');

  host.classList.add('composer');

  const findFragment = (kind: FragmentKind): AnyFragment | undefined =>
    graph.fragments.find((fragment) => fragment.kind === kind);

  function kindsForCategory(category: FragmentCategory): FragmentKind[] {
    return FRAGMENT_KINDS.filter((kind) => {
      if (FRAGMENT_DEFS[kind].category !== category) return false;
      return CORE_KINDS.has(kind) || showAdvanced || showFineTune || Boolean(findFragment(kind));
    });
  }

  const enabledCount = (category: FragmentCategory): number =>
    graph.fragments.filter(
      (fragment) => FRAGMENT_DEFS[fragment.kind].category === category && fragment.enabled,
    ).length;

  const emit = (): void => options.onChange(cloneGraph(graph));

  function renderControls(fragment: AnyFragment): string {
    const params = fragment.params as unknown as Record<string, unknown>;
    return controlSpecsFor(fragment.kind)
      .map((spec) => {
        const ariaLabel = escapeAttr(`${FRAGMENT_DEFS[fragment.kind].label} ${spec.label}`);
        if (spec.type === 'select') {
          const current = String(params[spec.key] ?? '');
          const opts = spec.options
            .map(
              (opt) =>
                `<option value="${escapeAttr(opt.value)}"${opt.value === current ? ' selected' : ''}>${opt.label}</option>`,
            )
            .join('');
          return `
            <div class="composer__ctrl">
              <span class="composer__ctrl-label">${spec.label}</span>
              <select class="composer__select" data-action="set-param" data-kind="${fragment.kind}"
                data-key="${spec.key}" aria-label="${ariaLabel}">${opts}</select>
            </div>`;
        }
        const value = Number(params[spec.key] ?? 0);
        return `
          <div class="composer__ctrl">
            <span class="composer__ctrl-label">${spec.label}</span>
            <input class="composer__range" type="range" min="${spec.min}" max="${spec.max}"
              step="${spec.step}" value="${value}" data-kind="${fragment.kind}" data-key="${spec.key}"
              aria-label="${ariaLabel}" />
            <span class="composer__ctrl-value" data-value-for="${fragment.kind}.${spec.key}">${fmtRange(spec, value)}</span>
          </div>`;
      })
      .join('');
  }

  /** Per-primitive Fine-tune stepper (0–10 strength) shown left of the name when on. */
  function renderGainStepper(fragment: AnyFragment): string {
    const label = escapeAttr(FRAGMENT_DEFS[fragment.kind].label);
    return `
      <span class="composer__gain" title="Fine-tune — ${label} strength (0–${FRAGMENT_GAIN_MAX})">
        <button type="button" class="composer__gain-step" data-action="gain-down" data-kind="${fragment.kind}"
          aria-label="Decrease ${label} strength">−</button>
        <span class="composer__gain-val" data-gain-for="${fragment.kind}">${fragment.gain}</span>
        <button type="button" class="composer__gain-step" data-action="gain-up" data-kind="${fragment.kind}"
          aria-label="Increase ${label} strength">+</button>
      </span>`;
  }

  function renderFragmentRow(kind: FragmentKind): string {
    const def = FRAGMENT_DEFS[kind];
    const fragment = findFragment(kind);
    const on = Boolean(fragment?.enabled);
    const isAdvanced = !CORE_KINDS.has(kind);
    const gainStepper = showFineTune && fragment ? renderGainStepper(fragment) : '';
    return `
      <div class="composer__frag${on ? ' is-on' : ''}">
        <div class="composer__frag-head">
          ${gainStepper}
          <label class="composer__frag-toggle">
            <input type="checkbox" data-action="toggle-frag" data-kind="${kind}"${on ? ' checked' : ''}
              aria-label="Enable ${escapeAttr(def.label)}" />
            <span class="composer__frag-name">${def.label}${isAdvanced ? '<span class="composer__adv-tag">adv</span>' : ''}</span>
          </label>
          <span class="composer__frag-info" title="${escapeAttr(def.blurb)}" tabindex="0" role="note"
            aria-label="${escapeAttr(def.blurb)}">?</span>
        </div>
        ${fragment ? `<div class="composer__frag-body">${renderControls(fragment)}</div>` : ''}
      </div>`;
  }

  function renderCategory(category: FragmentCategory, label: string): string {
    const kinds = kindsForCategory(category);
    if (kinds.length === 0) return '';
    const isOpen = expanded.has(category);
    const count = enabledCount(category);
    const badge =
      count > 0
        ? `<span class="composer__count is-on">${count} on</span>`
        : `<span class="composer__count">off</span>`;
    const body = isOpen
      ? `<div class="composer__cat-body">${kinds.map(renderFragmentRow).join('')}</div>`
      : '';
    return `
      <div class="composer__cat${isOpen ? ' is-open' : ''}">
        <button type="button" class="composer__cat-head" data-action="toggle-cat" data-cat="${category}"
          aria-expanded="${isOpen ? 'true' : 'false'}">
          <span class="composer__chevron" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
          <span class="composer__cat-label">${label}</span>
          ${badge}
        </button>
        ${body}
      </div>`;
  }

  function render(): void {
    const cats = CATEGORY_ORDER.map((entry) => renderCategory(entry.id, entry.label)).join('');
    host.innerHTML = `
      <div class="composer__toolbar">
        <span class="composer__toolbar-title">Make it yours</span>
        <div class="composer__toolbar-actions">
          <button type="button" class="composer__link" data-action="reset-order"
            title="Restore the recommended effect order">Reset order</button>
          <button type="button" class="composer__link composer__link--blank" data-action="blank-slate"
            title="Start from nothing — clear every effect">Blank slate</button>
        </div>
      </div>
      <label class="composer__advanced">
        <input type="checkbox" data-action="toggle-advanced"${showAdvanced ? ' checked' : ''} />
        <span>Show advanced effects</span>
      </label>
      <label class="composer__advanced">
        <input type="checkbox" data-action="toggle-finetune"${showFineTune ? ' checked' : ''} />
        <span>Fine-tune — per-effect strength</span>
      </label>
      <div class="composer__cats">${cats}</div>`;
  }

  function applyParam(kind: FragmentKind, key: string, value: number | string): void {
    const fragment = findFragment(kind);
    if (!fragment) return;
    (fragment.params as unknown as Record<string, unknown>)[key] = value;
  }

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

  function onChangeEvent(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.dataset?.action;
    if (action === 'toggle-advanced') {
      showAdvanced = (target as HTMLInputElement).checked;
      if (!showAdvanced) showFineTune = false;
      render();
    } else if (action === 'toggle-finetune') {
      showFineTune = (target as HTMLInputElement).checked;
      if (showFineTune) showAdvanced = true;
      render();
    } else if (action === 'toggle-frag') {
      const kind = target.dataset.kind as FragmentKind;
      const checked = (target as HTMLInputElement).checked;
      if (checked) {
        if (!findFragment(kind)) {
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
      expanded.add(FRAGMENT_DEFS[kind].category);
      render();
      emit();
    } else if (action === 'set-param' && target instanceof HTMLSelectElement) {
      applyParam(target.dataset.kind as FragmentKind, target.dataset.key as string, target.value);
      emit();
    }
  }

  /** Live drag of a native range control → update param + readout without a full re-render. */
  function onInput(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
    const kind = target.dataset.kind as FragmentKind;
    const key = target.dataset.key as string;
    if (!kind || !key) return;
    const value = Number(target.value);
    const min = Number(target.min);
    const readout = host.querySelector<HTMLElement>(`[data-value-for="${kind}.${key}"]`);
    if (readout) readout.textContent = value > 0 && min < 0 ? `+${value}` : String(value);
    applyParam(kind, key, value);
    emit();
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
      host.classList.remove('composer');
    },
  };
}
