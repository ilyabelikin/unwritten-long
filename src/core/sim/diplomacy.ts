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

export const isAtWar = (world: World, a: string, b: string): boolean => {
  if (a === b) return false
  const key = kingdomPairKey(a, b)
  return Boolean(world.kingdomConflicts[key])
}

export const setWarState = (world: World, a: string, b: string, atWar: boolean): void => {
  if (a === b) return
  const key = kingdomPairKey(a, b)
  world.kingdomConflicts[key] = atWar
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

export const buildInitialConflicts = (
  kingdomIds: string[],
  relations: Record<string, number>,
): Record<string, boolean> => {
  const conflicts: Record<string, boolean> = {}
  for (let i = 0; i < kingdomIds.length; i += 1) {
    for (let j = i + 1; j < kingdomIds.length; j += 1) {
      const key = kingdomPairKey(kingdomIds[i], kingdomIds[j])
      conflicts[key] = (relations[key] ?? 0) <= -58
    }
  }
  return conflicts
}

const averageSettlementProsperity = (world: World, kingdomId: string): number => {
  const controlled = Object.values(world.settlements).filter((settlement) => settlement.kingdomId === kingdomId)
  if (controlled.length === 0) return 40
  return controlled.reduce((sum, settlement) => sum + settlement.meta.prosperity, 0) / controlled.length
}

const adjustKingdomPolicies = (world: World, rng: SeededRng, messages: string[]): void => {
  if (world.turn % 10 !== 0) return
  for (const kingdom of Object.values(world.kingdoms)) {
    const prosperity = averageSettlementProsperity(world, kingdom.id)
    const policy = kingdom.policy
    const beforeTax = policy.taxRate
    const beforePatrol = policy.patrolFocus
    const beforeStance = policy.tradeStance

    if (prosperity < 35) {
      policy.taxRate = clamp(policy.taxRate - 0.01, 0.05, 0.28)
      policy.tradeStance = 'open'
    } else if (prosperity > 65 && rng.chance(0.35)) {
      policy.taxRate = clamp(policy.taxRate + 0.01, 0.05, 0.28)
    }

    const hostileNeighbors = Object.keys(world.kingdoms)
      .filter((id) => id !== kingdom.id)
      .filter((otherId) => relationBetween(world, kingdom.id, otherId) <= -35).length
    const targetPatrol = clamp(0.35 + hostileNeighbors * 0.18 + (100 - prosperity) * 0.003, 0.2, 1)
    policy.patrolFocus = Math.round(targetPatrol * 100) / 100
    if (hostileNeighbors >= 2 && policy.tradeStance !== 'protectionist') {
      policy.tradeStance = 'protectionist'
    } else if (hostileNeighbors === 0 && prosperity > 55) {
      policy.tradeStance = 'open'
    } else if (policy.tradeStance === 'protectionist' && hostileNeighbors === 1 && prosperity > 45) {
      policy.tradeStance = 'balanced'
    }

    const changed =
      Math.abs(beforeTax - policy.taxRate) > 0.001 ||
      Math.abs(beforePatrol - policy.patrolFocus) > 0.001 ||
      beforeStance !== policy.tradeStance
    if (changed && rng.chance(0.5)) {
      messages.push(
        `${kingdom.name} shifted policy (${policy.tradeStance}, tax ${(policy.taxRate * 100).toFixed(0)}%, patrol ${policy.patrolFocus.toFixed(2)}).`,
      )
    }
  }
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

      if (!isAtWar(world, a, b) && next <= -60) {
        setWarState(world, a, b, true)
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} slipped into open conflict.`)
      } else if (isAtWar(world, a, b) && next >= 20) {
        setWarState(world, a, b, false)
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} negotiated a ceasefire.`)
      }

      if ((current <= -40 && next > -30) || (current < 20 && next >= 30)) {
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} improved diplomatic ties.`)
      } else if ((current >= 35 && next < 20) || (current > -20 && next <= -30)) {
        messages.push(`${world.kingdoms[a].name} and ${world.kingdoms[b].name} relations worsened.`)
      }
    }
  }
  adjustKingdomPolicies(world, rng, messages)
  return messages
}

