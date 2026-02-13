export class SeededRng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state / 0xffffffff
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }
}

export const hashNoise = (seed: number, q: number, r: number, scale = 1): number => {
  const x = Math.sin((q * 12.9898 + r * 78.233 + seed * 0.12345) * scale) * 43758.5453
  return x - Math.floor(x)
}

