import type { HexCoord } from './types'

export const keyFor = (q: number, r: number): string => `${q},${r}`

export const parseKey = (id: string): HexCoord => {
  const [q, r] = id.split(',').map(Number)
  return { q, r }
}

export const directions: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export const neighborsOf = (coord: HexCoord): HexCoord[] =>
  directions.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }))

export const hexDistance = (a: HexCoord, b: HexCoord): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2

export const axialToPixel = (coord: HexCoord, size: number): { x: number; y: number } => {
  const x = size * Math.sqrt(3) * (coord.q + coord.r / 2)
  const y = size * 1.5 * coord.r
  return { x, y }
}

export const polygonPoints = (centerX: number, centerY: number, size: number): string => {
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = ((60 * i - 30) * Math.PI) / 180
    const x = centerX + size * Math.cos(angle)
    const y = centerY + size * Math.sin(angle)
    return `${x},${y}`
  })
  return points.join(' ')
}

