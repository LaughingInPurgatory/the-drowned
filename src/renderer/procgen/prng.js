export function mulberry32(seed) {
  return function rng() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

export function range(rng, min, max) {
  return min + rng() * (max - min)
}

export function intRange(rng, min, max) {
  return Math.floor(range(rng, min, max + 1))
}
