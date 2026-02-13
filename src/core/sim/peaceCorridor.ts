import type { World } from '../types'
import { clamp } from '../utils'
import { isAtWar, relationBetween } from './diplomacy'

export type CorridorHealth = 'inactive' | 'critical' | 'fragile' | 'stable' | 'robust'

export interface CorridorStatus {
  active: boolean
  stabilized: boolean
  partnerKingdomId?: string
  intensity: number
  turnsRemaining: number
  relation: number
  health: CorridorHealth
}

export const activePeaceCorridorForKingdom = (
  world: World,
  kingdomId?: string,
): { partnerKingdomId: string; intensity: number } | undefined => {
  if (!kingdomId) return undefined
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return undefined
  if (policy.peaceDividendUntilTurn < world.turn) return undefined
  const partnerKingdomId = policy.peaceDividendPartnerKingdomId
  if (!partnerKingdomId || partnerKingdomId === 'none' || !world.kingdoms[partnerKingdomId]) return undefined

  const partnerPolicy = world.kingdoms[partnerKingdomId].policy
  if (partnerPolicy.peaceDividendUntilTurn < world.turn) return undefined
  if (partnerPolicy.peaceDividendPartnerKingdomId !== kingdomId) return undefined
  if (isAtWar(world, kingdomId, partnerKingdomId)) return undefined
  if (relationBetween(world, kingdomId, partnerKingdomId) < -4) return undefined

  const intensity = clamp(Math.min(policy.peaceDividendIntensity, partnerPolicy.peaceDividendIntensity), 0, 100)
  if (intensity < 12) return undefined
  return { partnerKingdomId, intensity }
}

export const corridorStatusForPair = (
  world: World,
  leftKingdomId: string,
  rightKingdomId: string,
): CorridorStatus => {
  const leftPolicy = world.kingdoms[leftKingdomId]?.policy
  const rightPolicy = world.kingdoms[rightKingdomId]?.policy
  if (!leftPolicy || !rightPolicy) {
    return {
      active: false,
      stabilized: false,
      intensity: 0,
      turnsRemaining: -1,
      relation: relationBetween(world, leftKingdomId, rightKingdomId),
      health: 'inactive',
    }
  }

  const bilateralLink =
    leftPolicy.peaceDividendPartnerKingdomId === rightKingdomId &&
    rightPolicy.peaceDividendPartnerKingdomId === leftKingdomId
  const turnsRemaining = Math.min(leftPolicy.peaceDividendUntilTurn, rightPolicy.peaceDividendUntilTurn) - world.turn
  const intensity = clamp(Math.min(leftPolicy.peaceDividendIntensity, rightPolicy.peaceDividendIntensity), 0, 100)
  const relation = relationBetween(world, leftKingdomId, rightKingdomId)
  const atWar = isAtWar(world, leftKingdomId, rightKingdomId)
  const active = bilateralLink && turnsRemaining >= 0 && intensity > 0
  const stabilized = active && !atWar && relation >= -4

  let health: CorridorHealth = 'inactive'
  if (active && (!stabilized || turnsRemaining <= 1 || intensity <= 6)) {
    health = 'critical'
  } else if (active && (turnsRemaining <= 4 || relation < 14 || intensity < 20)) {
    health = 'fragile'
  } else if (active && relation >= 24 && turnsRemaining >= 8 && intensity >= 34) {
    health = 'robust'
  } else if (active) {
    health = 'stable'
  }

  return {
    active,
    stabilized,
    partnerKingdomId: active ? rightKingdomId : undefined,
    intensity,
    turnsRemaining,
    relation,
    health,
  }
}

export const guardLeniencyFromPeaceCorridor = (
  world: World,
  kingdomId?: string,
): { reputation: number; bounty: number } => {
  const corridor = activePeaceCorridorForKingdom(world, kingdomId)
  if (!corridor) return { reputation: 0, bounty: 0 }
  if (corridor.intensity >= 34) return { reputation: 4, bounty: 4 }
  if (corridor.intensity >= 18) return { reputation: 2, bounty: 2 }
  return { reputation: 0, bounty: 0 }
}

export const bountyDecayBonusFromPeaceCorridor = (world: World, tileId: string): number => {
  const tile = world.tiles[tileId]
  if (!tile?.settlementId) return 0
  const settlement = world.settlements[tile.settlementId]
  if (!settlement) return 0
  const corridor = activePeaceCorridorForKingdom(world, settlement.kingdomId)
  if (!corridor) return 0
  if (corridor.intensity >= 34) return 2
  if (corridor.intensity >= 18) return 1
  return 0
}

export const pardonDiscountMultiplierFromPeaceCorridor = (world: World, kingdomId?: string): number => {
  const corridor = activePeaceCorridorForKingdom(world, kingdomId)
  if (!corridor) return 1
  if (corridor.intensity >= 34) return 0.82
  if (corridor.intensity >= 18) return 0.9
  return 1
}

export const tariffReliefFromPeaceCorridor = (
  world: World,
  homeKingdomId?: string,
  foreignKingdomId?: string,
): number => {
  if (!homeKingdomId || !foreignKingdomId || homeKingdomId === foreignKingdomId) return 0
  const corridor = activePeaceCorridorForKingdom(world, homeKingdomId)
  if (!corridor || corridor.partnerKingdomId !== foreignKingdomId) return 0
  if (corridor.intensity >= 34) return 0.08
  if (corridor.intensity >= 18) return 0.04
  return 0
}

export const routeRiskReliefFromPeaceCorridor = (
  world: World,
  homeKingdomId?: string,
  foreignKingdomId?: string,
): number => {
  if (!homeKingdomId || !foreignKingdomId || homeKingdomId === foreignKingdomId) return 0
  const corridor = activePeaceCorridorForKingdom(world, homeKingdomId)
  if (!corridor || corridor.partnerKingdomId !== foreignKingdomId) return 0
  if (corridor.intensity >= 34) return 0.32
  if (corridor.intensity >= 18) return 0.18
  return 0
}
