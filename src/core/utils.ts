import { ALL_GOODS } from './constants'
import type { Good } from './types'

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const createGoodRecord = (initial = 0): Record<Good, number> =>
  ALL_GOODS.reduce(
    (acc, good) => {
      acc[good] = initial
      return acc
    },
    {} as Record<Good, number>,
  )

export const addGoods = (
  stock: Record<Good, number>,
  delta: Partial<Record<Good, number>>,
  multiplier = 1,
): void => {
  for (const [good, amount] of Object.entries(delta) as [Good, number][]) {
    stock[good] += amount * multiplier
  }
}

export const consumeGoods = (
  stock: Record<Good, number>,
  costs: Partial<Record<Good, number>>,
  multiplier = 1,
): boolean => {
  for (const [good, amount] of Object.entries(costs) as [Good, number][]) {
    if ((stock[good] ?? 0) < amount * multiplier) {
      return false
    }
  }
  for (const [good, amount] of Object.entries(costs) as [Good, number][]) {
    stock[good] -= amount * multiplier
  }
  return true
}

export const sumValues = (values: number[]): number => values.reduce((acc, cur) => acc + cur, 0)

