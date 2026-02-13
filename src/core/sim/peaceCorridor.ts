import type { World } from '../types'
import { clamp } from '../utils'
import { isAtWar, relationBetween } from './diplomacy'

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
