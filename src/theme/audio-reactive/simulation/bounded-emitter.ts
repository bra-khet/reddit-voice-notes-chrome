export const BOUNDED_PARTICLE_EMITTER_MAX_CAPACITY = 256;

export interface BoundedParticle {
  active: boolean;
  age: number;
  lifetime: number;
}

export type BoundedParticleFactory<T extends BoundedParticle> = (index: number) => T;
export type BoundedParticleInitializer<T extends BoundedParticle> = (
  particle: T,
  index: number,
  recycled: boolean,
) => void;

function normalizeCapacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(
    BOUNDED_PARTICLE_EMITTER_MAX_CAPACITY,
    Math.max(1, Math.floor(value)),
  );
}

function normalizeLimit(value: number, capacity: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(capacity, Math.max(0, Math.floor(value)));
}

/**
 * CHANGED: Inferno gets one fixed-capacity lifetime emitter with deterministic slot reuse.
 * WHY: continuous flame, ember, and smoke births need arbitrary expiry without allocating particles in capture RAF.
 */
export class BoundedParticleEmitter<T extends BoundedParticle> {
  readonly capacity: number;
  readonly particles: readonly T[];

  private mutableLimit: number;
  private mutableActiveCount = 0;
  private cursor = 0;

  constructor(capacity: number, factory: BoundedParticleFactory<T>) {
    this.capacity = normalizeCapacity(capacity);
    this.mutableLimit = this.capacity;
    this.particles = Array.from({ length: this.capacity }, (_, index) => {
      const particle = factory(index);
      particle.active = false;
      particle.age = 0;
      particle.lifetime = Math.max(0.001, Number.isFinite(particle.lifetime) ? particle.lifetime : 1);
      return particle;
    });
  }

  get limit(): number {
    return this.mutableLimit;
  }

  get activeCount(): number {
    return this.mutableActiveCount;
  }

  /** Adjust the live slot ceiling without reallocating the backing particle set. */
  configureLimit(limit: number): number {
    const nextLimit = normalizeLimit(limit, this.capacity);
    if (nextLimit < this.mutableLimit) {
      for (let index = nextLimit; index < this.mutableLimit; index += 1) {
        const particle = this.particles[index];
        if (!particle?.active) continue;
        particle.active = false;
        this.mutableActiveCount -= 1;
      }
    }
    this.mutableLimit = nextLimit;
    this.cursor = nextLimit > 0 ? this.cursor % nextLimit : 0;
    return nextLimit;
  }

  /** Emit into the next inactive slot; when full, deterministically recycle the cursor slot. */
  emit(initialize: BoundedParticleInitializer<T>): T | null {
    if (this.mutableLimit === 0) return null;

    let index = this.cursor;
    let recycled = true;
    for (let offset = 0; offset < this.mutableLimit; offset += 1) {
      const candidate = (this.cursor + offset) % this.mutableLimit;
      if (this.particles[candidate]?.active) continue;
      index = candidate;
      recycled = false;
      break;
    }

    const particle = this.particles[index];
    if (!particle) return null;
    if (!particle.active) this.mutableActiveCount += 1;
    particle.active = true;
    particle.age = 0;
    particle.lifetime = 1;
    initialize(particle, index, recycled);
    particle.age = Math.max(0, Number.isFinite(particle.age) ? particle.age : 0);
    particle.lifetime = Math.max(
      0.001,
      Number.isFinite(particle.lifetime) ? particle.lifetime : 1,
    );
    this.cursor = (index + 1) % this.mutableLimit;
    return particle;
  }

  /** Advance only lifetime state; the consuming preset owns physics and rendering. */
  advance(dt: number): void {
    const elapsed = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (elapsed === 0) return;
    for (let index = 0; index < this.mutableLimit; index += 1) {
      const particle = this.particles[index];
      if (!particle?.active) continue;
      particle.age += elapsed;
      if (particle.age < particle.lifetime) continue;
      particle.active = false;
      this.mutableActiveCount -= 1;
    }
  }

  clear(): void {
    for (const particle of this.particles) {
      particle.active = false;
      particle.age = 0;
    }
    this.mutableActiveCount = 0;
    this.cursor = 0;
  }
}
