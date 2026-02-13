import { clamp } from '../utils'
import { SeededRng } from '../random'
import type { World } from '../types'

export const kingdomPairKey = (a: string, b: string): string =>
  [a, b].sort((left, right) => left.localeCompare(right)).join('|')

export const relationBetween = (world: World, a: string, b: string): number => {
  if (a === b) return 100
  const key = kingdomPairKey(a, b)
  return world.kingdomRelations[key] ?? 0
}

export const setRelation = (world: World, a: string, b: string, value: number): void => {
  if (a === b) return
  const key = kingdomPairKey(a, b)
  world.kingdomRelations[key] = clamp(Math.round(value), -100, 100)
}

export const buildInitialRelations = (
  kingdomIds: string[],
  rng: SeededRng,
): Record<string, number> => {
  const relations: Record<string, number> = {}
  for (let i = 0; i < kingdomIds.length; i += 1) {
    for (let j = i + 1; j < kingdomIds.length; j += 1) {
      const key = kingdomPairKey(kingdomIds[i], kingdomIds[j])
      relations[key] = rng.int(-20, 70)
    }
  }
  return relations
}

export const simulateDiplomacyTurn = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  if (world.turn % 12 !== 0) return messages
  const kingdomIds = Object.keys(world.kingdoms)
  for (let i = 0; i < kingdomIds.length; i += 1) {
    for (let j = i + 1; j < kingdomIds.length; j += 1) {
      const a = kingdomIds[i]
      const b = kingdomIds[j]
      const current = relationBetween(world, a, b)
      const drift = rng.int(-8, 7)
      const next = clamp(current + drift, -100, 100)
      setRelation(world, a, b, next)
      if ((current <= -40 && next > -30) || (current < 20 && next >= 30)) {
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} improved diplomatic ties.`)
      } else if ((current >= 35 && next < 20) || (current > -20 && next <= -30)) {
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} relations worsened.`)
      }
    }
  }
  return messages
}

