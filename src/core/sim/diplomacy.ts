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
    const beforeRepHostility = policy.guardHostilityReputation
    const beforeBountyHostility = policy.guardHostilityBounty
    const beforeBountyDecay = policy.bountyDecayPerTick
    const beforePardonFactor = policy.pardonGoldFactor

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

    if (hostileNeighbors >= 2) {
      policy.guardHostilityReputation = clamp(Math.round(policy.guardHostilityReputation + 1), -30, -6)
      policy.guardHostilityBounty = clamp(Math.round(policy.guardHostilityBounty - 1), 10, 34)
      policy.bountyDecayPerTick = clamp(Math.round(policy.bountyDecayPerTick - 1), 1, 5)
      policy.pardonGoldFactor = clamp(policy.pardonGoldFactor + 0.03, 0.6, 1.8)
    } else if (prosperity < 35) {
      policy.guardHostilityReputation = clamp(Math.round(policy.guardHostilityReputation - 1), -30, -6)
      policy.guardHostilityBounty = clamp(Math.round(policy.guardHostilityBounty + 1), 10, 34)
      policy.bountyDecayPerTick = clamp(Math.round(policy.bountyDecayPerTick + 1), 1, 5)
      policy.pardonGoldFactor = clamp(policy.pardonGoldFactor - 0.03, 0.6, 1.8)
    }

    const changed =
      Math.abs(beforeTax - policy.taxRate) > 0.001 ||
      Math.abs(beforePatrol - policy.patrolFocus) > 0.001 ||
      beforeStance !== policy.tradeStance ||
      beforeRepHostility !== policy.guardHostilityReputation ||
      beforeBountyHostility !== policy.guardHostilityBounty ||
      beforeBountyDecay !== policy.bountyDecayPerTick ||
      Math.abs(beforePardonFactor - policy.pardonGoldFactor) > 0.001
    if (changed && rng.chance(0.5)) {
      messages.push(
        `${kingdom.name} shifted policy (${policy.tradeStance}, tax ${(policy.taxRate * 100).toFixed(0)}%, patrol ${policy.patrolFocus.toFixed(2)}, law rep<=${policy.guardHostilityReputation}, bounty>=${policy.guardHostilityBounty}).`,
      )
    }
  }
}

const capitalSettlement = (world: World, kingdomId: string) => {
  const kingdom = world.kingdoms[kingdomId]
  const explicit = kingdom?.capitalSettlementId ? world.settlements[kingdom.capitalSettlementId] : undefined
  if (explicit) return explicit
  return Object.values(world.settlements)
    .filter((settlement) => settlement.kingdomId === kingdomId)
    .sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
}

const bilateralPeaceDividendIntensity = (world: World, left: string, right: string): number => {
  const leftPolicy = world.kingdoms[left]?.policy
  const rightPolicy = world.kingdoms[right]?.policy
  if (!leftPolicy || !rightPolicy) return 0
  if (leftPolicy.peaceDividendPartnerKingdomId !== right) return 0
  if (rightPolicy.peaceDividendPartnerKingdomId !== left) return 0
  if (leftPolicy.peaceDividendUntilTurn < world.turn || rightPolicy.peaceDividendUntilTurn < world.turn) return 0
  return clamp(Math.min(leftPolicy.peaceDividendIntensity, rightPolicy.peaceDividendIntensity), 0, 100)
}

const applyPeaceDividendEffects = (world: World, messages: string[]): void => {
  const pairKeys = Object.keys(world.kingdomRelations)
  for (const pair of pairKeys) {
    const [left, right] = pair.split('|')
    const intensity = bilateralPeaceDividendIntensity(world, left, right)
    if (intensity <= 0) continue

    const relationBoost = Math.max(1, Math.round(intensity / 14))
    setRelation(world, left, right, relationBetween(world, left, right) + relationBoost)

    const treasuryBoost = Math.max(3, Math.round(intensity / 5))
    const leftCapital = capitalSettlement(world, left)
    const rightCapital = capitalSettlement(world, right)
    if (leftCapital) leftCapital.treasury += treasuryBoost
    if (rightCapital) rightCapital.treasury += treasuryBoost

    const stabilization = clamp(0.8 + intensity * 0.025, 0.8, 3.4)
    const settlements = Object.values(world.settlements).filter(
      (settlement) => settlement.kingdomId === left || settlement.kingdomId === right,
    )
    for (const settlement of settlements) {
      settlement.meta.siegePressure = clamp(settlement.meta.siegePressure - stabilization * 0.9, 0, 100)
      settlement.meta.foodStress = clamp(settlement.meta.foodStress - stabilization, 0, 100)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + stabilization * 0.4, 0, 100)
    }

    if (world.turn % 24 === 0) {
      messages.push(
        `${world.kingdoms[left].name} and ${world.kingdoms[right].name} enjoyed a post-summit trade boom.`,
      )
    }
  }
}

const applyDiplomaticIncident = (world: World, rng: SeededRng, messages: string[]): void => {
  if (world.turn % 18 !== 0) return
  const pairs = Object.keys(world.kingdomRelations)
  if (pairs.length === 0) return
  const chosen = pairs[rng.int(0, pairs.length - 1)]
  const [left, right] = chosen.split('|')
  const relation = relationBetween(world, left, right)
  const leftKingdom = world.kingdoms[left]
  const rightKingdom = world.kingdoms[right]
  if (!leftKingdom || !rightKingdom) return

  const leftCapital = capitalSettlement(world, left)
  const rightCapital = capitalSettlement(world, right)

  if (!isAtWar(world, left, right) && relation >= 42) {
    const bonus = rng.int(12, 28)
    if (leftCapital) leftCapital.treasury += bonus
    if (rightCapital) rightCapital.treasury += bonus
    setRelation(world, left, right, relation + 8)
    messages.push(
      `${leftKingdom.name} and ${rightKingdom.name} signed a trade charter (+${bonus} treasury each).`,
    )
    return
  }

  if (!isAtWar(world, left, right) && relation <= -22) {
    const loss = rng.int(4, 12)
    if (leftCapital) leftCapital.treasury = Math.max(0, leftCapital.treasury - loss)
    if (rightCapital) rightCapital.treasury = Math.max(0, rightCapital.treasury - loss)
    setRelation(world, left, right, relation - 10)
    messages.push(`${leftKingdom.name} and ${rightKingdom.name} suffered a violent border incident.`)
    return
  }

  if (isAtWar(world, left, right) && relation >= -8) {
    setRelation(world, left, right, relation + 10)
    messages.push(`${leftKingdom.name} and ${rightKingdom.name} opened armistice talks.`)
    return
  }

  if (isAtWar(world, left, right) && rng.chance(0.5)) {
    setRelation(world, left, right, relation + 6)
    if (leftCapital) leftCapital.meta.foodStress = clamp(leftCapital.meta.foodStress + 2, 0, 100)
    if (rightCapital) rightCapital.meta.foodStress = clamp(rightCapital.meta.foodStress + 2, 0, 100)
    messages.push(`${leftKingdom.name} and ${rightKingdom.name} suffered war exhaustion.`)
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
      const peaceDividend = bilateralPeaceDividendIntensity(world, a, b)
      const drift = peaceDividend > 0 ? rng.int(-3, 8) : rng.int(-8, 7)
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
  applyPeaceDividendEffects(world, messages)
  applyDiplomaticIncident(world, rng, messages)
  adjustKingdomPolicies(world, rng, messages)
  return messages
}

