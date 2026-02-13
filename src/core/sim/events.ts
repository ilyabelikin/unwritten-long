import { keyFor, neighborsOf } from '../hex'
import { SeededRng } from '../random'
import { clamp } from '../utils'
import { isAtWar, kingdomPairKey, relationBetween, setRelation } from './diplomacy'
import type { Character, Contract, Settlement, Species, World } from '../types'

const wildlifeForTile = (rng: SeededRng): Species => {
  const roll = rng.next()
  if (roll < 0.38) return 'rabbit'
  if (roll < 0.63) return 'deer'
  if (roll < 0.8) return 'boar'
  if (roll < 0.94) return 'wolf'
  return 'bear'
}

const createSimpleCharacter = (
  id: string,
  role: Character['role'],
  species: Species,
  tileId: string,
  name: string,
): Character => ({
  id,
  name,
  role,
  species,
  hp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  maxHp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  ap: 4,
  maxAp: 4,
  age: 3,
  skills: { combat: role === 'monster' ? 6 : role === 'bandit' ? 4 : 2, travel: 3 },
  history: [`Appeared near ${tileId}.`],
  traits: [role === 'migrant' ? 'hopeful' : role === 'bandit' ? 'ruthless' : 'restless'],
  flaws: [role === 'migrant' ? 'weak' : 'reckless'],
  reputation: role === 'migrant' ? 2 : -30,
  location: tileId,
  alive: true,
  inventory: {},
  meta: {},
})

const randomLandTileBy = (
  world: World,
  predicate: (tileId: string) => boolean,
  rng: SeededRng,
): string | undefined => {
  const candidates = world.tileOrder.filter(
    (id) => world.tiles[id].terrain !== 'sea' && world.characters[world.playerId].location !== id && predicate(id),
  )
  if (candidates.length === 0) return undefined
  return candidates[rng.int(0, candidates.length - 1)]
}

const activePeaceDividendIntensityForKingdom = (world: World, kingdomId: string): number => {
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return 0
  if (policy.peaceDividendUntilTurn < world.turn) return 0
  return clamp(policy.peaceDividendIntensity, 0, 100)
}

const peaceDividendIntensityForPair = (world: World, left: string, right: string): number => {
  const leftPolicy = world.kingdoms[left]?.policy
  const rightPolicy = world.kingdoms[right]?.policy
  if (!leftPolicy || !rightPolicy) return 0
  if (leftPolicy.peaceDividendPartnerKingdomId !== right) return 0
  if (rightPolicy.peaceDividendPartnerKingdomId !== left) return 0
  if (leftPolicy.peaceDividendUntilTurn < world.turn || rightPolicy.peaceDividendUntilTurn < world.turn) return 0
  return clamp(Math.min(leftPolicy.peaceDividendIntensity, rightPolicy.peaceDividendIntensity), 0, 100)
}

export const trySpawnWarRefugee = (world: World, rng: SeededRng, pair: string): string | undefined => {
  const [left, right] = pair.split('|')
  const peaceIntensity = peaceDividendIntensityForPair(world, left, right)
  if (peaceIntensity >= 18) return undefined
  const conflictBorderTiles = world.tileOrder.filter((tileId) => {
    const tile = world.tiles[tileId]
    const tileKingdomId = tile.kingdomId
    if (!tileKingdomId || (tileKingdomId !== left && tileKingdomId !== right)) return false
    return neighborsOf(tile.coord).some((neighbor) => {
      const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
      if (!neighborTile?.kingdomId || neighborTile.kingdomId === tileKingdomId) return false
      return kingdomPairKey(tileKingdomId, neighborTile.kingdomId) === pair
    })
  })
  const fallbackTiles = world.tileOrder.filter((tileId) => {
    const tile = world.tiles[tileId]
    return tile.kingdomId === left || tile.kingdomId === right
  })
  const refugeTargets = Object.values(world.settlements)
    .filter((settlement) => settlement.kingdomId !== left && settlement.kingdomId !== right)
    .sort((a, b) => b.meta.prosperity - a.meta.prosperity)
  const spawnPool = conflictBorderTiles.length > 0 ? conflictBorderTiles : fallbackTiles
  const spawnTile = spawnPool[rng.int(0, Math.max(0, spawnPool.length - 1))]
  const safeTarget = refugeTargets[0]
  if (!spawnTile || !safeTarget) return undefined

  const id = `refugee-${world.turn}-${rng.int(100, 999)}`
  const refugee = createSimpleCharacter(id, 'migrant', 'human', spawnTile, `Refugee ${rng.int(10, 99)}`)
  refugee.meta.targetSettlementId = safeTarget.id
  refugee.meta.refugeeFromConflict = pair
  refugee.meta.pathProgress = 0
  world.characters[id] = refugee
  return `War refugees fled the ${world.kingdoms[left]?.name ?? left}/${world.kingdoms[right]?.name ?? right} frontier.`
}

export const tryRepatriatePeaceRefugee = (
  world: World,
  rng: SeededRng,
  pair: string,
): string | undefined => {
  const [left, right] = pair.split('|')
  const peaceIntensity = peaceDividendIntensityForPair(world, left, right)
  if (peaceIntensity < 18) return undefined
  if (!world.kingdoms[left] || !world.kingdoms[right]) return undefined

  const refugees = Object.values(world.characters).filter(
    (character) =>
      character.alive &&
      character.role === 'migrant' &&
      character.meta.refugeeFromConflict === pair &&
      character.meta.returningHome !== true,
  )
  if (refugees.length === 0) return undefined

  const homeSettlements = Object.values(world.settlements)
    .filter((settlement) => settlement.kingdomId === left || settlement.kingdomId === right)
    .sort((a, b) => b.meta.prosperity - a.meta.prosperity)
  const destination = homeSettlements[0]
  if (!destination) return undefined

  const refugee = refugees[rng.int(0, refugees.length - 1)]
  refugee.meta.targetSettlementId = destination.id
  refugee.meta.returningHome = true
  refugee.meta.pathProgress = 0
  return `${refugee.name} set out to return home as the ${world.kingdoms[left].name}/${world.kingdoms[right].name} corridor stabilizes.`
}

const currentSettlementForPlayer = (world: World) => {
  const player = world.characters[world.playerId]
  if (!player?.alive) return undefined
  const tile = world.tiles[player.location]
  if (!tile?.settlementId) return undefined
  return world.settlements[tile.settlementId]
}

const kingdomInvolvedInWar = (world: World, kingdomId: string): boolean =>
  Object.keys(world.kingdomConflicts).some((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === kingdomId || right === kingdomId
  })

const hasActiveManhuntGuard = (world: World, kingdomId: string): boolean =>
  Object.values(world.characters).some((character) => {
    if (!character.alive || character.role !== 'guard') return false
    if (character.meta.justiceManhunt !== true) return false
    return character.meta.manhuntKingdomId === kingdomId
  })

export const tryDeclareManhunt = (
  world: World,
  rng: SeededRng,
  kingdomId: string,
): string | undefined => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player?.alive || !settlement || settlement.kingdomId !== kingdomId) return undefined
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return undefined
  const bounty = Number(player.meta.bounty ?? 0)
  if (bounty < policy.guardHostilityBounty + 6) return undefined
  if (hasActiveManhuntGuard(world, kingdomId)) return undefined
  const spawnTile = settlement.tiles[rng.int(0, settlement.tiles.length - 1)]
  const id = `marshal-${world.turn}-${rng.int(100, 999)}`
  const marshal = createSimpleCharacter(id, 'guard', 'human', spawnTile, `${world.kingdoms[kingdomId].name} Marshal`)
  marshal.skills.combat = 7
  marshal.skills.patrol = 6
  marshal.homeSettlementId = settlement.id
  marshal.meta.justiceManhunt = true
  marshal.meta.expiresTurn = world.turn + 16
  marshal.meta.manhuntKingdomId = kingdomId
  if (settlement.tier === 'city') {
    marshal.meta.guardCityId = settlement.id
  }
  world.characters[id] = marshal
  player.meta.manhuntKingdomId = kingdomId
  player.meta.manhuntExpiresTurn = world.turn + 16
  return `${world.kingdoms[kingdomId].name} declared a manhunt and deployed city marshals.`
}

export const tryIssueAmnestyDecree = (world: World, kingdomId: string): string | undefined => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player?.alive || !settlement || settlement.kingdomId !== kingdomId) return undefined
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return undefined
  const bounty = Number(player.meta.bounty ?? 0)
  if (bounty <= 0) return undefined
  if (policy.tradeStance === 'protectionist' || policy.pardonGoldFactor > 1.2) return undefined
  if (kingdomInvolvedInWar(world, kingdomId)) return undefined

  const reduction = clamp(
    Math.round(policy.bountyDecayPerTick * 3 + (1.2 - policy.pardonGoldFactor) * 4),
    4,
    16,
  )
  player.meta.bounty = Math.max(0, bounty - reduction)
  player.reputation += 2
  world.playerKingdomFavor[kingdomId] = clamp((world.playerKingdomFavor[kingdomId] ?? 0) + 1, 0, 100)
  return `${world.kingdoms[kingdomId].name} announced an amnesty decree. Your bounty fell by ${reduction}.`
}

export const tryCorruptionCrackdown = (
  world: World,
  kingdomId: string,
): string | undefined => {
  const kingdom = world.kingdoms[kingdomId]
  if (!kingdom) return undefined
  const policy = kingdom.policy
  const crisis = policy.tradeStance === 'protectionist' || policy.pardonGoldFactor > 1.15 || kingdomInvolvedInWar(world, kingdomId)
  if (!crisis) return undefined

  policy.guardHostilityReputation = clamp(Math.round(policy.guardHostilityReputation + 2), -30, -6)
  policy.guardHostilityBounty = clamp(Math.round(policy.guardHostilityBounty - 2), 10, 34)
  policy.bountyDecayPerTick = clamp(Math.round(policy.bountyDecayPerTick - 1), 1, 5)
  policy.pardonGoldFactor = clamp(policy.pardonGoldFactor + 0.08, 0.6, 1.8)

  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (player?.alive && settlement?.kingdomId === kingdomId) {
    const bounty = Number(player.meta.bounty ?? 0)
    if (bounty > 0) {
      player.meta.bounty = clamp(bounty + 3, 0, 9999)
    }
  }

  return `${kingdom.name} launched anti-corruption crackdowns, tightening legal enforcement.`
}

export const simulateJusticeEvents = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const player = world.characters[world.playerId]
  if (!player?.alive) return messages
  const currentSettlement = currentSettlementForPlayer(world)

  if (world.turn % 8 === 0 && currentSettlement) {
    const kingdomId = currentSettlement.kingdomId
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const strictChance = clamp(
        0.24 +
          (policy.guardHostilityReputation > -15 ? 0.18 : 0) +
          (policy.guardHostilityBounty < 18 ? 0.16 : 0),
        0.1,
        0.68,
      )
      if (rng.chance(strictChance)) {
        const message = tryDeclareManhunt(world, rng, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  if (world.turn % 10 === 0 && currentSettlement) {
    const kingdomId = currentSettlement.kingdomId
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const amnestyChance = policy.tradeStance === 'open' ? 0.32 : policy.tradeStance === 'balanced' ? 0.16 : 0.05
      if (rng.chance(amnestyChance)) {
        const message = tryIssueAmnestyDecree(world, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  if (world.turn % 14 === 0) {
    const kingdomIds = Object.keys(world.kingdoms)
    const kingdomId = kingdomIds[rng.int(0, kingdomIds.length - 1)]
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const crackdownChance =
        policy.tradeStance === 'protectionist'
          ? 0.46
          : kingdomInvolvedInWar(world, kingdomId)
            ? 0.3
            : 0.12
      if (rng.chance(crackdownChance)) {
        const message = tryCorruptionCrackdown(world, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  return messages
}

const averageProsperityForKingdom = (world: World, kingdomId: string): number => {
  const settlements = Object.values(world.settlements).filter((settlement) => settlement.kingdomId === kingdomId)
  if (settlements.length === 0) return 45
  return settlements.reduce((sum, settlement) => sum + settlement.meta.prosperity, 0) / settlements.length
}

const averageFoodStressForKingdom = (world: World, kingdomId: string): number => {
  const settlements = Object.values(world.settlements).filter((settlement) => settlement.kingdomId === kingdomId)
  if (settlements.length === 0) return 0
  return settlements.reduce((sum, settlement) => sum + settlement.meta.foodStress, 0) / settlements.length
}

const warCountForKingdom = (world: World, kingdomId: string): number =>
  Object.keys(world.kingdomConflicts).filter((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === kingdomId || right === kingdomId
  }).length

const isEdictExpired = (world: World, kingdomId: string): boolean => {
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy || policy.activeEdict === 'none') return false
  return policy.edictExpiresTurn >= 0 && world.turn > policy.edictExpiresTurn
}

type CourtFaction = World['kingdoms'][string]['policy']['courtFaction']
const allCourtFactions: CourtFaction[] = ['merchant_bloc', 'war_hawks', 'reformers']

const factionLabel = (faction: CourtFaction): string => {
  if (faction === 'merchant_bloc') return 'Merchant Bloc'
  if (faction === 'war_hawks') return 'War Hawks'
  return 'Reformers'
}

const factionScores = (
  world: World,
  kingdomId: string,
  prosperity: number,
  avgFoodStress: number,
  wars: number,
) => {
  const policy = world.kingdoms[kingdomId].policy
  const merchantScore =
    36 +
    prosperity * 0.55 +
    (policy.tradeStance === 'open' ? 8 : 0) +
    (wars === 0 ? 8 : -wars * 4) +
    (policy.taxRate <= 0.12 ? 4 : -2)
  const warHawkScore =
    28 +
    wars * 18 +
    (policy.tradeStance === 'protectionist' ? 7 : 0) +
    (policy.guardHostilityBounty <= 18 ? 6 : 0) +
    (100 - policy.courtStability) * 0.18
  const reformerScore =
    30 +
    avgFoodStress * 0.65 +
    (prosperity < 45 ? 7 : 0) +
    (policy.pardonGoldFactor <= 1 ? 5 : 0) +
    (policy.taxRate >= 0.15 ? 5 : 0)
  return {
    merchant_bloc: merchantScore,
    war_hawks: warHawkScore,
    reformers: reformerScore,
  }
}

const dominantFaction = (
  scores: Record<CourtFaction, number>,
): { faction: CourtFaction; score: number; second: number } => {
  const entries = Object.entries(scores) as [CourtFaction, number][]
  const sorted = entries.sort((a, b) => b[1] - a[1])
  return {
    faction: sorted[0][0],
    score: sorted[0][1],
    second: sorted[1]?.[1] ?? sorted[0][1],
  }
}

const setCourtEdict = (
  world: World,
  kingdomId: string,
  edict: World['kingdoms'][string]['policy']['activeEdict'],
  duration: number,
): void => {
  const policy = world.kingdoms[kingdomId].policy
  policy.activeEdict = edict
  policy.edictExpiresTurn = world.turn + duration
}

const capitalSettlementForKingdom = (world: World, kingdomId: string): Settlement | undefined => {
  const kingdom = world.kingdoms[kingdomId]
  const capitalId = kingdom?.capitalSettlementId
  if (capitalId && world.settlements[capitalId]) return world.settlements[capitalId]
  return Object.values(world.settlements)
    .filter((settlement) => settlement.kingdomId === kingdomId)
    .sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
}

const openContractCountForSettlement = (world: World, settlementId: string): number =>
  Object.values(world.contracts).filter(
    (contract) =>
      contract.settlementId === settlementId &&
      (contract.status === 'available' || contract.status === 'active'),
  ).length

const hasOpenRivalryContractForKingdom = (world: World, kingdomId: string): boolean =>
  Object.values(world.contracts).some(
    (contract) =>
      contract.issuerKingdomId === kingdomId &&
      contract.status !== 'completed' &&
      contract.status !== 'expired' &&
      contract.meta.rivalryIncident === true,
  )

const hasOpenTruceContractForKingdom = (world: World, kingdomId: string): boolean =>
  Object.values(world.contracts).some(
    (contract) =>
      contract.issuerKingdomId === kingdomId &&
      contract.status !== 'completed' &&
      contract.status !== 'expired' &&
      contract.meta.truceIncident === true,
  )

const newRivalryContractId = (world: World, rng: SeededRng): string =>
  `contract-rivalry-${world.turn}-${rng.int(100, 999)}-${Object.keys(world.contracts).length + 1}`

const newTruceContractId = (world: World, rng: SeededRng): string =>
  `contract-truce-${world.turn}-${rng.int(100, 999)}-${Object.keys(world.contracts).length + 1}`

const createFactionRivalryContract = (
  world: World,
  kingdomId: string,
  faction: CourtFaction,
  rivalFaction: CourtFaction,
  rng: SeededRng,
): Contract | undefined => {
  const issuer = capitalSettlementForKingdom(world, kingdomId)
  if (!issuer || openContractCountForSettlement(world, issuer.id) >= 4) return undefined
  const level = clamp(
    2 + Math.floor((world.campaignProgress[kingdomId] ?? 0) / 4) + (world.kingdoms[kingdomId].policy.factionTension >= 70 ? 1 : 0),
    1,
    4,
  )

  let kind: Contract['kind']
  if (faction === 'war_hawks') kind = rng.chance(0.6) ? 'defend_settlement' : 'hunt_bandits'
  else if (faction === 'merchant_bloc') kind = issuer.tier === 'city' && rng.chance(0.55) ? 'escort_caravan' : 'deliver_food'
  else kind = rng.chance(0.65) ? 'deliver_food' : 'defend_settlement'

  const contract: Contract = {
    id: newRivalryContractId(world, rng),
    settlementId: issuer.id,
    issuerKingdomId: kingdomId,
    kind,
    level,
    status: 'available',
    requiredAmount:
      kind === 'deliver_food'
        ? clamp(6 + level * 2, 6, 18)
        : kind === 'escort_caravan'
          ? clamp(10 + level * 2, 8, 20)
          : kind === 'defend_settlement'
            ? clamp(2 + Math.floor(level / 2), 2, 5)
            : clamp(1 + Math.floor(level / 2), 1, 3),
    progress: 0,
    rewardReputation: 7 + level * 2,
    rewardBountyReduction: 5 + level,
    rewardGoods:
      faction === 'merchant_bloc'
        ? { tools: 2, iron_ingot: 1 }
        : faction === 'war_hawks'
          ? { tools: 2, gold_ore: 1 }
          : { grain: 3, vegetables: 2 },
    expiresTurn: world.turn + (24 - level),
    meta: {
      rivalryIncident: true,
      courtFaction: faction,
      rivalFaction,
      courtDirective: `${factionLabel(faction)} Counter-Mandate`,
      minCourtFavor: clamp(8 + level, 8, 26),
      minReputation: clamp(8 + level * 2, 8, 60),
    },
  }

  if (kind === 'deliver_food') {
    contract.good = faction === 'merchant_bloc' ? 'grain' : 'fish'
  }
  if (kind === 'escort_caravan') {
    const destination = Object.values(world.settlements)
      .filter((settlement) => settlement.id !== issuer.id && settlement.kingdomId === kingdomId)
      .sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    if (!destination) {
      contract.kind = 'deliver_food'
      contract.good = 'grain'
      contract.requiredAmount = clamp(7 + level * 2, 6, 18)
    } else {
      contract.meta.destinationSettlementId = destination.id
      contract.good = 'tools'
    }
  }
  if (kind === 'defend_settlement') {
    contract.meta.targetSettlementId = issuer.id
    contract.rewardBountyReduction += 2
  }
  if (kind === 'hunt_bandits') {
    contract.rewardBountyReduction += 3
  }

  return contract
}

const createFactionTruceContract = (
  world: World,
  kingdomId: string,
  primaryFaction: CourtFaction,
  partnerFaction: CourtFaction,
  rng: SeededRng,
  options?: {
    summitChainId?: string
    summitStage?: number
    summitTotalStages?: number
    forcedKind?: Contract['kind']
  },
): Contract | undefined => {
  const issuer = capitalSettlementForKingdom(world, kingdomId)
  if (!issuer || openContractCountForSettlement(world, issuer.id) >= 4) return undefined

  const level = clamp(
    2 +
      Math.floor((world.campaignProgress[kingdomId] ?? 0) / 5) +
      (world.kingdoms[kingdomId].policy.factionTension >= 72 ? 1 : 0),
    1,
    4,
  )
  const kind: Contract['kind'] = options?.forcedKind ?? (rng.chance(0.5) ? 'escort_caravan' : 'deliver_food')
  const minStanding = clamp(6 + level, 6, 20)
  const trucePair = [primaryFaction, partnerFaction].sort().join('|')

  const contract: Contract = {
    id: newTruceContractId(world, rng),
    settlementId: issuer.id,
    issuerKingdomId: kingdomId,
    kind,
    level,
    status: 'available',
    good: kind === 'deliver_food' ? 'grain' : 'tools',
    requiredAmount: kind === 'deliver_food' ? clamp(7 + level * 2, 6, 20) : clamp(9 + level * 2, 8, 20),
    progress: 0,
    rewardReputation: 8 + level * 2,
    rewardBountyReduction: 6 + level,
    rewardGoods: {
      tools: 1 + Math.floor(level / 2),
      grain: 2,
      vegetables: 1,
    },
    expiresTurn: world.turn + (26 - level),
    meta: {
      truceIncident: true,
      trucePair,
      courtFaction: primaryFaction,
      rivalFaction: partnerFaction,
      courtDirective: `${factionLabel(primaryFaction)}-${factionLabel(partnerFaction)} Truce Summit`,
      minCourtFavor: minStanding,
      minCourtFavorByFaction: {
        [primaryFaction]: minStanding,
        [partnerFaction]: minStanding,
      },
      minReputation: clamp(8 + level * 2, 8, 60),
      summitChainId: options?.summitChainId,
      summitStage: options?.summitStage ?? 1,
      summitTotalStages: options?.summitTotalStages ?? 1,
      locked: (options?.summitStage ?? 1) > 1,
    },
  }

  if (kind === 'escort_caravan') {
    const destination = Object.values(world.settlements)
      .filter((settlement) => settlement.id !== issuer.id && settlement.kingdomId === kingdomId)
      .sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    if (!destination) {
      contract.kind = 'deliver_food'
      contract.good = 'fish'
      contract.requiredAmount = clamp(8 + level * 2, 6, 20)
    } else {
      contract.meta.destinationSettlementId = destination.id
    }
  }

  return contract
}

const createFactionTruceSummitChain = (
  world: World,
  kingdomId: string,
  primaryFaction: CourtFaction,
  partnerFaction: CourtFaction,
  rng: SeededRng,
): Contract[] => {
  const chainId = `summit-${kingdomId}-${world.turn}-${rng.int(100, 999)}`
  const stageKinds: [Contract['kind'], Contract['kind']] = rng.chance(0.5)
    ? ['deliver_food', 'escort_caravan']
    : ['escort_caravan', 'deliver_food']
  const stage1 = createFactionTruceContract(world, kingdomId, primaryFaction, partnerFaction, rng, {
    summitChainId: chainId,
    summitStage: 1,
    summitTotalStages: 2,
    forcedKind: stageKinds[0],
  })
  const stage2 = createFactionTruceContract(world, kingdomId, primaryFaction, partnerFaction, rng, {
    summitChainId: chainId,
    summitStage: 2,
    summitTotalStages: 2,
    forcedKind: stageKinds[1],
  })
  if (!stage1 || !stage2) return []
  stage2.level = clamp(stage2.level + 1, 1, 4)
  stage2.rewardReputation += 3
  stage2.rewardBountyReduction += 2
  stage2.meta.minCourtFavorByFaction = {
    [primaryFaction]: clamp(Number((stage2.meta.minCourtFavorByFaction as Record<string, number>)[primaryFaction] ?? 0) + 2, 6, 30),
    [partnerFaction]: clamp(Number((stage2.meta.minCourtFavorByFaction as Record<string, number>)[partnerFaction] ?? 0) + 2, 6, 30),
  }
  stage2.meta.locked = true
  return [stage1, stage2]
}

export const simulateCourtPolitics = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const kingdomIds = Object.keys(world.kingdoms)

  for (const kingdomId of kingdomIds) {
    const policy = world.kingdoms[kingdomId]?.policy
    if (!policy) continue
    if (isEdictExpired(world, kingdomId)) {
      messages.push(`${world.kingdoms[kingdomId].name}'s ${policy.activeEdict.replace('_', ' ')} edict expired.`)
      policy.activeEdict = 'none'
      policy.edictExpiresTurn = -1
    }
    if (
      policy.factionTrucePair !== 'none' &&
      policy.factionTruceUntilTurn >= 0 &&
      world.turn > policy.factionTruceUntilTurn
    ) {
      messages.push(`${world.kingdoms[kingdomId].name}'s faction truce summit ended.`)
      policy.factionTrucePair = 'none'
      policy.factionTruceUntilTurn = -1
    }
  }

  if (world.turn % 9 !== 0) return messages

  for (const kingdomId of kingdomIds) {
    const kingdom = world.kingdoms[kingdomId]
    const policy = kingdom.policy
    const prosperity = averageProsperityForKingdom(world, kingdomId)
    const avgFoodStress = averageFoodStressForKingdom(world, kingdomId)
    const wars = warCountForKingdom(world, kingdomId)
    const truceActive = policy.factionTrucePair !== 'none' && policy.factionTruceUntilTurn >= world.turn

    policy.courtStability = clamp(
      Math.round(policy.courtStability + (prosperity >= 58 ? 2 : -2) - wars * 2 + (policy.tradeStance === 'open' ? 1 : 0)),
      0,
      100,
    )
    policy.nobleInfluence = clamp(
      Math.round(policy.nobleInfluence + (policy.taxRate >= 0.16 ? 2 : 0) + wars - (prosperity >= 60 ? 1 : 0)),
      0,
      100,
    )

    const scores = factionScores(world, kingdomId, prosperity, avgFoodStress, wars)
    const factionResult = dominantFaction(scores)
    const scoreGap = factionResult.score - factionResult.second
    const currentFactionScore = scores[policy.courtFaction]
    if (factionResult.faction !== policy.courtFaction) {
      policy.factionTension = clamp(
        Math.round(policy.factionTension + Math.max(1, (factionResult.score - currentFactionScore) * 0.45)),
        0,
        100,
      )
      if (policy.factionTension >= 60 || (scoreGap >= 14 && rng.chance(0.55))) {
        policy.courtFaction = factionResult.faction
        policy.factionTension = clamp(policy.factionTension - 18, 0, 100)
        messages.push(`${kingdom.name} court shifted influence to the ${policy.courtFaction.replace('_', ' ')} faction.`)
      }
    } else {
      policy.factionTension = clamp(policy.factionTension - 3, 0, 100)
    }
    if (truceActive) {
      policy.factionTension = clamp(policy.factionTension - 6, 0, 100)
      policy.courtStability = clamp(policy.courtStability + 2, 0, 100)
    }

    if (policy.courtStability <= 30 && policy.nobleInfluence >= 58 && rng.chance(0.55)) {
      setCourtEdict(world, kingdomId, 'martial_law', 15)
      policy.tradeStance = 'protectionist'
      policy.guardHostilityReputation = clamp(policy.guardHostilityReputation + 2, -30, -6)
      policy.guardHostilityBounty = clamp(policy.guardHostilityBounty - 2, 10, 34)
      const otherId = kingdomIds.filter((id) => id !== kingdomId).sort((left, right) =>
        relationBetween(world, kingdomId, left) - relationBetween(world, kingdomId, right),
      )[0]
      if (otherId) setRelation(world, kingdomId, otherId, relationBetween(world, kingdomId, otherId) - 6)
      messages.push(`${kingdom.name} suffered a noble court coup and imposed martial law.`)
      continue
    }

    const faction = policy.courtFaction
    if (policy.activeEdict === 'none' && faction === 'war_hawks' && (wars >= 2 || policy.courtStability < 26)) {
      setCourtEdict(world, kingdomId, 'martial_law', 14)
      policy.tradeStance = 'protectionist'
      messages.push(`${kingdom.name}'s war hawks forced an emergency martial law decree.`)
      continue
    }

    if (
      policy.activeEdict === 'none' &&
      faction === 'reformers' &&
      (avgFoodStress > 24 || prosperity < 42 || policy.courtStability < 35)
    ) {
      setCourtEdict(world, kingdomId, 'tax_relief', 12)
      policy.taxRate = clamp(policy.taxRate - 0.01, 0.05, 0.28)
      policy.pardonGoldFactor = clamp(policy.pardonGoldFactor - 0.05, 0.6, 1.8)
      messages.push(`${kingdom.name}'s reformers enacted a tax relief edict to calm unrest.`)
      continue
    }

    if (
      policy.activeEdict === 'none' &&
      faction === 'merchant_bloc' &&
      prosperity > 58 &&
      wars === 0 &&
      (scoreGap >= 8 || rng.chance(0.5))
    ) {
      setCourtEdict(world, kingdomId, 'trade_fair', 12)
      policy.tradeStance = 'open'
      const partnerId = kingdomIds
        .filter((id) => id !== kingdomId)
        .sort((left, right) => relationBetween(world, kingdomId, right) - relationBetween(world, kingdomId, left))[0]
      if (partnerId) setRelation(world, kingdomId, partnerId, relationBetween(world, kingdomId, partnerId) + 5)
      messages.push(`${kingdom.name}'s merchant bloc announced a grand trade fair edict.`)
      continue
    }

    if (policy.activeEdict === 'none' && prosperity < 38 && rng.chance(0.34)) {
      setCourtEdict(world, kingdomId, 'tax_relief', 12)
      policy.taxRate = clamp(policy.taxRate - 0.01, 0.05, 0.28)
      messages.push(`${kingdom.name} enacted a court-backed tax relief edict to calm unrest.`)
      continue
    }

    if (policy.activeEdict === 'none' && prosperity > 62 && wars === 0 && rng.chance(0.3)) {
      setCourtEdict(world, kingdomId, 'trade_fair', 12)
      policy.tradeStance = 'open'
      const partnerId = kingdomIds
        .filter((id) => id !== kingdomId)
        .sort((left, right) => relationBetween(world, kingdomId, right) - relationBetween(world, kingdomId, left))[0]
      if (partnerId) setRelation(world, kingdomId, partnerId, relationBetween(world, kingdomId, partnerId) + 5)
      messages.push(`${kingdom.name} announced a grand trade fair edict from its royal court.`)
    }

    if (!truceActive && !hasOpenRivalryContractForKingdom(world, kingdomId) && policy.factionTension >= 46) {
      const rivals = allCourtFactions.filter((candidate) => candidate !== policy.courtFaction)
      const rivalFaction = rivals.sort(
        (left, right) => scores[right] - scores[left],
      )[0]
      const rivalryChance = clamp(0.2 + (policy.factionTension - 46) * 0.012, 0.2, 0.72)
      if (rivalFaction && rng.chance(rivalryChance)) {
        const contract = createFactionRivalryContract(world, kingdomId, policy.courtFaction, rivalFaction, rng)
        if (contract) {
          world.contracts[contract.id] = contract
          messages.push(
            `${kingdom.name}'s ${factionLabel(policy.courtFaction)} challenged the ${factionLabel(rivalFaction)} with a court mandate.`,
          )
          policy.factionTension = clamp(policy.factionTension - 8, 0, 100)
        }
      }
    }

    if (!truceActive && !hasOpenTruceContractForKingdom(world, kingdomId) && policy.factionTension >= 64) {
      const contenders = allCourtFactions
        .filter((candidate) => candidate !== policy.courtFaction)
        .sort((left, right) => scores[right] - scores[left])
      const summitPartner = contenders[0]
      const truceChance = clamp(0.22 + (policy.factionTension - 64) * 0.012, 0.22, 0.7)
      if (summitPartner && rng.chance(truceChance)) {
        const summitContracts = createFactionTruceSummitChain(
          world,
          kingdomId,
          policy.courtFaction,
          summitPartner,
          rng,
        )
        if (summitContracts.length > 0) {
          for (const contract of summitContracts) {
            world.contracts[contract.id] = contract
          }
          policy.factionTrucePair = [policy.courtFaction, summitPartner].sort().join('|')
          policy.factionTruceUntilTurn = world.turn + 10
          policy.factionTension = clamp(policy.factionTension - 14, 0, 100)
          messages.push(
            `${kingdom.name} hosted a truce summit between ${factionLabel(policy.courtFaction)} and ${factionLabel(summitPartner)} with staged mandates.`,
          )
        }
      }
    }
  }

  return messages
}

export const spawnWorldEvents = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const spawn = (character: Character): void => {
    if (world.characters[character.id]) return
    world.characters[character.id] = character
  }

  const chanceScale = world.season === 'winter' ? 0.85 : 1

  if (rng.chance(0.17 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].road, rng)
    if (tileId) {
      const id = `bandit-${world.turn}-${rng.int(100, 999)}`
      const bandit = createSimpleCharacter(id, 'bandit', 'human', tileId, `Bandit ${rng.int(10, 99)}`)
      bandit.meta.hostile = true
      spawn(bandit)
      messages.push('Bandits were spotted on a major road.')
    }
  }

  if (rng.chance(0.14 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].terrain === 'mountain', rng)
    if (tileId) {
      const id = `monster-${world.turn}-${rng.int(100, 999)}`
      const monster = createSimpleCharacter(
        id,
        'monster',
        rng.chance(0.65) ? 'ogre' : 'wyrm',
        tileId,
        rng.chance(0.65) ? 'Ogre' : 'Wyrm',
      )
      spawn(monster)
      messages.push('A roaming monster emerged from the highlands.')
    }
  }

  if (rng.chance(0.12)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].vegetation === 'deep_forest', rng)
    if (tileId) {
      const species = wildlifeForTile(rng)
      const id = `wild-${world.turn}-${rng.int(100, 999)}`
      spawn(createSimpleCharacter(id, 'wildlife', species, tileId, species))
      messages.push(`${species} were seen in the deep forests.`)
    }
  }

  if (rng.chance(0.11)) {
    const migratoryPool = Object.values(world.settlements).filter((settlement) => {
      const peaceIntensity = activePeaceDividendIntensityForKingdom(world, settlement.kingdomId)
      if (peaceIntensity < 16) return true
      return settlement.meta.foodStress >= 26
    })
    const sourcePool = migratoryPool.length > 0 ? migratoryPool : Object.values(world.settlements)
    const settlement = sourcePool.sort((a, b) => a.populationIds.length - b.populationIds.length)[0]
    const target = Object.values(world.settlements).sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    if (settlement && target && settlement.id !== target.id) {
      const id = `migrant-${world.turn}-${rng.int(100, 999)}`
      const migrant = createSimpleCharacter(id, 'migrant', 'human', settlement.tiles[0], `Migrant ${rng.int(10, 99)}`)
      migrant.meta.targetSettlementId = target.id
      migrant.meta.pathProgress = 0
      spawn(migrant)
      messages.push(`Migrants left ${settlement.name} for ${target.name}.`)
    }
  }

  const city = Object.values(world.settlements).find((s) => s.tier === 'city')
  const cityPeaceIntensity = city ? activePeaceDividendIntensityForKingdom(world, city.kingdomId) : 0
  const raidChance = (world.season === 'winter' ? 0.08 : 0.03) * clamp(1 - cityPeaceIntensity * 0.02, 0.3, 1)
  if (rng.chance(raidChance)) {
    if (city) {
      const ring = city.tiles.flatMap((tileId) =>
        neighborsOf(world.tiles[tileId].coord).map((n) => keyFor(n.q, n.r)),
      )
      const candidates = ring.filter((id) => world.tiles[id] && world.tiles[id].terrain !== 'sea')
      const tileId = candidates[rng.int(0, Math.max(0, candidates.length - 1))]
      if (tileId) {
        const id = `raid-${world.turn}-${rng.int(100, 999)}`
        const monster = createSimpleCharacter(id, 'monster', 'ogre', tileId, 'Raider Ogre')
        spawn(monster)
        messages.push(`A raiding monster approaches ${city.name}.`)
      }
    }
  }

  const warPairs = Object.keys(world.kingdomConflicts).filter((pair) => world.kingdomConflicts[pair])
  if (warPairs.length > 0 && world.turn % 9 === 0) {
    const selectedPair = warPairs[rng.int(0, warPairs.length - 1)]
    const [leftKingdom, rightKingdom] = selectedPair.split('|')
    const peaceIntensity = peaceDividendIntensityForPair(world, leftKingdom, rightKingdom)
    const warbandChance = 0.65 * clamp(1 - peaceIntensity * 0.025, 0.2, 1)
    if (rng.chance(warbandChance) && isAtWar(world, leftKingdom, rightKingdom)) {
      const borderTiles = world.tileOrder.filter((tileId) => {
        const tile = world.tiles[tileId]
        if (tile.kingdomId !== leftKingdom && tile.kingdomId !== rightKingdom) return false
        return neighborsOf(tile.coord).some((neighbor) => {
          const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
          if (!neighborTile || neighborTile.terrain === 'sea') return false
          return kingdomPairKey(tile.kingdomId ?? '', neighborTile.kingdomId ?? '') === selectedPair
        })
      })

      const spawnTile = borderTiles[rng.int(0, Math.max(0, borderTiles.length - 1))]
      if (spawnTile) {
        const id = `warband-${world.turn}-${rng.int(100, 999)}`
        const warband = createSimpleCharacter(id, 'bandit', 'human', spawnTile, 'Warband')
        warband.skills.combat = 6
        warband.meta.hostile = true
        warband.meta.warPair = selectedPair
        spawn(warband)
        messages.push(
          `${world.kingdoms[leftKingdom]?.name ?? leftKingdom} and ${world.kingdoms[rightKingdom]?.name ?? rightKingdom} clashed at the frontier.`,
        )
      }
    }
  }

  if (warPairs.length > 0 && world.turn % 7 === 0 && rng.chance(0.55)) {
    const pair = warPairs[rng.int(0, warPairs.length - 1)]
    const refugeeMessage = trySpawnWarRefugee(world, rng, pair)
    if (refugeeMessage) messages.push(refugeeMessage)
  }

  if (world.turn % 8 === 0 && rng.chance(0.45)) {
    const dividendPairs = Object.keys(world.kingdomRelations).filter((pair) => {
      const [left, right] = pair.split('|')
      return peaceDividendIntensityForPair(world, left, right) >= 18
    })
    if (dividendPairs.length > 0) {
      const pair = dividendPairs[rng.int(0, dividendPairs.length - 1)]
      const returnMessage = tryRepatriatePeaceRefugee(world, rng, pair)
      if (returnMessage) messages.push(returnMessage)
    }
  }

  return messages
}

