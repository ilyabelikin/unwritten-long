import { FOOD_GOODS } from '../constants'
import { shortestPath } from '../pathing'
import { SeededRng } from '../random'
import type { Contract, Good, Settlement, World } from '../types'
import { clamp } from '../utils'
import { campaignRankTitleForReputation } from './campaignRank'
import { isAtWar, kingdomPairKey, relationBetween, setRelation, setWarState } from './diplomacy'

type KingdomExclusivePool = 'harvest' | 'warden' | 'guild'
type CourtFaction = World['kingdoms'][string]['policy']['courtFaction']

const EXCLUSIVE_TITLE_BY_POOL: Record<KingdomExclusivePool, string> = {
  harvest: 'Harvest Charter',
  warden: 'Warden Writ',
  guild: 'Guild Patent',
}

const COURT_DIRECTIVE_BY_FACTION: Record<CourtFaction, string> = {
  merchant_bloc: 'Commercial Charter',
  war_hawks: 'Security Mandate',
  reformers: 'Civic Reform Petition',
}

const COURT_PATRON_TITLE_BY_FACTION: Record<CourtFaction, string> = {
  merchant_bloc: 'Guild Patronage',
  war_hawks: 'Marshal Patronage',
  reformers: 'Civic Patronage',
}

const activeContractForPlayer = (world: World): Contract | undefined =>
  Object.values(world.contracts).find(
    (contract) => contract.status === 'active' && contract.assignedCharacterId === world.playerId,
  )

const newContractId = (world: World, prefix: string, rng: SeededRng): string =>
  `${prefix}-${world.turn}-${rng.int(100, 999)}-${Object.keys(world.contracts).length + 1}`

const favorForKingdom = (world: World, kingdomId: string): number =>
  Number(world.playerKingdomFavor[kingdomId] ?? 0)

const addFavorForKingdom = (world: World, kingdomId: string, amount: number): void => {
  world.playerKingdomFavor[kingdomId] = clamp(favorForKingdom(world, kingdomId) + amount, 0, 100)
}

const parseCourtFaction = (value: unknown): CourtFaction | undefined =>
  value === 'merchant_bloc' || value === 'war_hawks' || value === 'reformers' ? value : undefined

const parseCourtFactionPair = (value: unknown): [CourtFaction, CourtFaction] | undefined => {
  if (typeof value !== 'string') return undefined
  const [left, right] = value.split('|')
  const a = parseCourtFaction(left)
  const b = parseCourtFaction(right)
  if (!a || !b || a === b) return undefined
  return [a, b]
}

const courtFavorForFaction = (world: World, faction: CourtFaction): number =>
  Number(world.playerCourtFavor[faction] ?? 0)

const addCourtFavor = (world: World, faction: CourtFaction, amount: number): void => {
  world.playerCourtFavor[faction] = clamp(courtFavorForFaction(world, faction) + amount, 0, 100)
}

const courtFactionForSettlement = (world: World, settlement: Settlement): CourtFaction =>
  world.kingdoms[settlement.kingdomId]?.policy.courtFaction ?? 'merchant_bloc'

const applyCourtFactionContractFlavor = (
  world: World,
  settlement: Settlement,
  contract: Contract,
): Contract => {
  const faction = courtFactionForSettlement(world, settlement)
  contract.meta.courtFaction = faction
  contract.meta.courtDirective = COURT_DIRECTIVE_BY_FACTION[faction]

  const minRep = Number(contract.meta.minReputation ?? 0)
  if (faction === 'merchant_bloc') {
    if (contract.kind === 'escort_caravan' || contract.kind === 'deliver_food') {
      contract.rewardReputation += 1
      contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
      if (contract.kind === 'escort_caravan') {
        contract.rewardGoods.iron_ingot = (contract.rewardGoods.iron_ingot ?? 0) + 1
      }
      if (minRep > 0) {
        contract.meta.minReputation = clamp(minRep + 1, 0, 100)
      }
    } else {
      contract.rewardGoods.gold_ore = (contract.rewardGoods.gold_ore ?? 0) + 1
    }
    return contract
  }

  if (faction === 'war_hawks') {
    contract.meta.minReputation = clamp(Math.max(minRep, 0) + 2, 0, 100)
    if (contract.kind === 'defend_settlement' || contract.kind === 'hunt_bandits') {
      contract.rewardBountyReduction += 3
      contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
    } else {
      contract.requiredAmount = Math.ceil(contract.requiredAmount * 1.1)
      contract.rewardGoods.gold_ore = (contract.rewardGoods.gold_ore ?? 0) + 1
    }
    return contract
  }

  contract.rewardReputation += 2
  contract.rewardBountyReduction += 1
  if (contract.kind === 'deliver_food' || contract.kind === 'defend_settlement') {
    contract.rewardGoods.grain = (contract.rewardGoods.grain ?? 0) + 2
  } else {
    contract.rewardGoods.vegetables = (contract.rewardGoods.vegetables ?? 0) + 1
  }
  if (minRep > 0) {
    contract.meta.minReputation = clamp(Math.max(0, minRep - 1), 0, 100)
  }
  return contract
}

const applyCourtPatronage = (world: World, contract: Contract, rng: SeededRng): Contract => {
  if (contract.meta.campaign) return contract
  const faction = parseCourtFaction(contract.meta.courtFaction)
  if (!faction) return contract

  const standing = courtFavorForFaction(world, faction)
  const threshold = faction === 'merchant_bloc' ? 12 : faction === 'war_hawks' ? 10 : 9
  if (standing < threshold) return contract
  const chance = standing >= 24 ? 0.48 : 0.24
  if (!rng.chance(chance)) return contract

  contract.meta.courtPatronage = true
  contract.meta.minCourtFavor = standing >= 24 ? 18 : threshold
  contract.meta.courtPatronTitle = COURT_PATRON_TITLE_BY_FACTION[faction]
  contract.level = clamp(contract.level + (standing >= 24 ? 1 : 0), 1, 4)
  contract.requiredAmount = Math.ceil(contract.requiredAmount * (faction === 'war_hawks' ? 1.08 : 1.04))

  if (faction === 'merchant_bloc') {
    contract.rewardReputation += 2
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 2
    contract.rewardGoods.iron_ingot = (contract.rewardGoods.iron_ingot ?? 0) + 1
    return contract
  }

  if (faction === 'war_hawks') {
    contract.rewardBountyReduction += 4
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
    contract.meta.minReputation = clamp(Math.max(Number(contract.meta.minReputation ?? 0), 14) + 2, 0, 100)
    return contract
  }

  contract.rewardReputation += 3
  contract.rewardBountyReduction += 1
  contract.rewardGoods.grain = (contract.rewardGoods.grain ?? 0) + 2
  contract.rewardGoods.vegetables = (contract.rewardGoods.vegetables ?? 0) + 1
  contract.meta.minReputation = clamp(Math.max(0, Number(contract.meta.minReputation ?? 0) - 1), 0, 100)
  return contract
}

export const kingdomExclusivePool = (world: World, kingdomId: string): KingdomExclusivePool => {
  const ordinal = Number(kingdomId.split('-')[1] ?? 0)
  const signal = Math.abs((world.seed % 97) + ordinal)
  const index = signal % 3
  if (index === 0) return 'harvest'
  if (index === 1) return 'warden'
  return 'guild'
}

const createFoodDeliveryContract = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  level: number,
): Contract => {
  const good = rng.pick(FOOD_GOODS)
  const need = settlement.needs[good] ?? 2
  const requiredAmount = clamp(Math.ceil(need * (1.2 + level * 0.24)), 4, 18)
  return {
    id: newContractId(world, 'contract-food', rng),
    settlementId: settlement.id,
    issuerKingdomId: settlement.kingdomId,
    kind: 'deliver_food',
    level,
    status: 'available',
    good,
    requiredAmount,
    progress: 0,
    rewardReputation: 4 + Math.ceil(requiredAmount / 4) + level,
    rewardBountyReduction: 3 + level,
    rewardGoods: { tools: level >= 2 ? 2 : 1, gold_ore: level >= 3 ? 1 : 0 },
    expiresTurn: world.turn + (30 - level * 2),
    meta: {},
  }
}

const createBanditHuntContract = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  level: number,
): Contract => ({
  id: newContractId(world, 'contract-hunt', rng),
  settlementId: settlement.id,
  issuerKingdomId: settlement.kingdomId,
  kind: 'hunt_bandits',
  level,
  status: 'available',
  requiredAmount: clamp(level, 1, 3),
  progress: 0,
  rewardReputation: 6 + level * 2,
  rewardBountyReduction: 6 + level * 2,
  rewardGoods: { gold_ore: level >= 2 ? 2 : 1, tools: 1 + level },
  expiresTurn: world.turn + (34 - level),
  meta: {},
})

const findNearbySettlement = (world: World, settlement: Settlement): Settlement | undefined => {
  const center = world.tiles[settlement.tiles[0]].coord
  return Object.values(world.settlements)
    .filter((candidate) => candidate.id !== settlement.id)
    .map((candidate) => ({
      settlement: candidate,
      distance:
        Math.abs(center.q - world.tiles[candidate.tiles[0]].coord.q) +
        Math.abs(center.r - world.tiles[candidate.tiles[0]].coord.r),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.settlement
}

const createEscortContract = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  level: number,
): Contract => {
  const target = findNearbySettlement(world, settlement)
  const requiredAmount = clamp(rng.int(8 + level, 14 + level * 2), 6, 20)
  return {
    id: newContractId(world, 'contract-escort', rng),
    settlementId: settlement.id,
    issuerKingdomId: settlement.kingdomId,
    kind: 'escort_caravan',
    level,
    status: 'available',
    good: 'grain',
    requiredAmount,
    progress: 0,
    rewardReputation: 8 + level * 2,
    rewardBountyReduction: 6 + level * 2,
    rewardGoods: { tools: 1 + level, gold_ore: level >= 2 ? 1 : 0 },
    expiresTurn: world.turn + (30 - level),
    meta: {
      destinationSettlementId: target?.id,
    },
  }
}

const createDefendContract = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  level: number,
): Contract => ({
  id: newContractId(world, 'contract-defend', rng),
  settlementId: settlement.id,
  issuerKingdomId: settlement.kingdomId,
  kind: 'defend_settlement',
  level,
  status: 'available',
  requiredAmount: clamp(2 + Math.floor(level / 2), 2, 4),
  progress: 0,
  rewardReputation: 9 + level * 2,
  rewardBountyReduction: 8 + level * 2,
  rewardGoods: { tools: 2 + level, gold_ore: level >= 2 ? 2 : 1 },
  expiresTurn: world.turn + (30 - level),
  meta: {
    targetSettlementId: settlement.id,
  },
})

const minFavorForExclusive = (favor: number): number => {
  if (favor >= 28) return 16
  if (favor >= 16) return 12
  return 8
}

const createExclusiveContractForKingdom = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  level: number,
  favor: number,
  hasWar: boolean,
  underSiege: boolean,
): Contract => {
  const pool = kingdomExclusivePool(world, settlement.kingdomId)
  const boostedLevel = clamp(level + (favor >= 18 ? 1 : 0), 1, 4)
  let contract: Contract
  if (pool === 'harvest') {
    contract = createFoodDeliveryContract(world, settlement, rng, boostedLevel)
    contract.good = rng.pick(['grain', 'fish', 'vegetables'] as Good[])
    contract.rewardGoods.grain = (contract.rewardGoods.grain ?? 0) + 2
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
  } else if (pool === 'warden') {
    contract =
      (hasWar || underSiege || settlement.meta.siegePressure > 16) && settlement.tier !== 'hamlet'
        ? createDefendContract(world, settlement, rng, boostedLevel)
        : createBanditHuntContract(world, settlement, rng, boostedLevel)
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 2
  } else {
    const nearby = findNearbySettlement(world, settlement)
    if (nearby) {
      contract = createEscortContract(world, settlement, rng, boostedLevel)
      contract.meta.destinationSettlementId = nearby.id
      contract.good = rng.pick(['tools', 'iron_ingot', 'grain'] as Good[])
      contract.rewardGoods.iron_ingot = (contract.rewardGoods.iron_ingot ?? 0) + 1
    } else {
      contract = createBanditHuntContract(world, settlement, rng, boostedLevel)
    }
  }

  contract.requiredAmount = Math.ceil(contract.requiredAmount * (pool === 'guild' ? 1.28 : 1.2))
  contract.rewardReputation += 3 + (favor >= 22 ? 2 : 0)
  contract.rewardBountyReduction += pool === 'warden' ? 4 : 2
  contract.rewardGoods.gold_ore = (contract.rewardGoods.gold_ore ?? 0) + (favor >= 20 ? 2 : 1)
  const baseReputation = pool === 'warden' ? 10 : pool === 'harvest' ? 12 : 14
  contract.meta.exclusive = true
  contract.meta.exclusivePool = pool
  contract.meta.minFavor = minFavorForExclusive(favor)
  contract.meta.minReputation = clamp(baseReputation + contract.level * 3 + (favor >= 20 ? 2 : 0), 8, 60)
  contract.meta.exclusiveTitle = EXCLUSIVE_TITLE_BY_POOL[pool]
  return contract
}

const contractCountForSettlement = (world: World, settlementId: string): number =>
  Object.values(world.contracts).filter(
    (contract) =>
      contract.settlementId === settlementId &&
      (contract.status === 'available' || contract.status === 'active'),
  ).length

const capitalSettlementForKingdom = (world: World, kingdomId: string): Settlement | undefined => {
  const capitalId = world.kingdoms[kingdomId]?.capitalSettlementId
  if (capitalId && world.settlements[capitalId]) return world.settlements[capitalId]
  return Object.values(world.settlements).find((settlement) => settlement.kingdomId === kingdomId)
}

const activePeaceDividendForSettlement = (
  world: World,
  settlement: Settlement,
): { intensity: number; partnerKingdomId?: string } => {
  const policy = world.kingdoms[settlement.kingdomId]?.policy
  if (!policy) return { intensity: 0 }
  if (policy.peaceDividendUntilTurn < world.turn) return { intensity: 0 }
  const intensity = clamp(policy.peaceDividendIntensity, 0, 100)
  const partnerKingdomId =
    typeof policy.peaceDividendPartnerKingdomId === 'string' &&
    policy.peaceDividendPartnerKingdomId !== 'none'
      ? policy.peaceDividendPartnerKingdomId
      : undefined
  return { intensity, partnerKingdomId }
}

const createContractForSettlement = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
): Contract => {
  const hasWar = Object.keys(world.kingdomConflicts).some((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === settlement.kingdomId || right === settlement.kingdomId
  })
  const pressure =
    settlement.meta.foodStress > 18 ||
    settlement.needs.grain + settlement.needs.fish > settlement.stockpile.grain + settlement.stockpile.fish
  const underSiege = settlement.meta.siegePressure > 28
  const courtFaction = courtFactionForSettlement(world, settlement)
  const peaceDividend = activePeaceDividendForSettlement(world, settlement)
  const peaceBoom = peaceDividend.intensity >= 14 && !underSiege && settlement.meta.foodStress < 42
  const campaignRank = Math.floor((world.campaignProgress[settlement.kingdomId] ?? 0) / 3)
  const baseLevel = settlement.tier === 'city' ? 3 : settlement.tier === 'town' ? 2 : 1
  const level = clamp(
    baseLevel +
      campaignRank +
      (hasWar ? 1 : 0) +
      (underSiege ? 1 : 0) +
      (settlement.meta.foodStress > 35 ? 1 : 0),
    1,
    4,
  )
  let contract: Contract
  if (peaceBoom && !hasWar && rng.chance(clamp(0.26 + peaceDividend.intensity * 0.008, 0.26, 0.68))) {
    contract =
      settlement.tier === 'city' || rng.chance(0.42)
        ? createEscortContract(world, settlement, rng, level)
        : createFoodDeliveryContract(world, settlement, rng, level)
    contract.rewardReputation += 2
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
    if (contract.kind === 'deliver_food') {
      contract.good = rng.pick(['grain', 'fish', 'vegetables'] as Good[])
      contract.rewardGoods.grain = (contract.rewardGoods.grain ?? 0) + 1
    } else {
      contract.good = rng.pick(['tools', 'grain', 'iron_ingot'] as Good[])
    }
    contract.expiresTurn += 2
    contract.meta.peaceDividendOpportunity = true
    contract.meta.peaceDividendIntensity = peaceDividend.intensity
    if (peaceDividend.partnerKingdomId) {
      contract.meta.peaceDividendPartnerKingdomId = peaceDividend.partnerKingdomId
    }
  } else if ((hasWar || underSiege) && settlement.tier !== 'hamlet' && rng.chance(underSiege ? 0.75 : 0.5)) {
    contract = createDefendContract(world, settlement, rng, level)
  } else if (settlement.tier === 'city' && rng.chance(0.4)) {
    contract = createEscortContract(world, settlement, rng, level)
  } else if (pressure) {
    contract = createFoodDeliveryContract(world, settlement, rng, level)
  } else {
    contract = createBanditHuntContract(world, settlement, rng, level)
  }

  if (!contract.meta.campaign && contract.meta.peaceDividendOpportunity !== true) {
    if (courtFaction === 'war_hawks' && settlement.tier !== 'hamlet' && !underSiege && rng.chance(0.22)) {
      contract = createDefendContract(world, settlement, rng, clamp(level + 1, 1, 4))
    } else if (courtFaction === 'merchant_bloc' && settlement.tier === 'city' && rng.chance(0.24)) {
      contract = createEscortContract(world, settlement, rng, level)
    } else if (courtFaction === 'reformers' && pressure && rng.chance(0.35)) {
      contract = createFoodDeliveryContract(world, settlement, rng, clamp(level + 1, 1, 4))
    }
  }

  const favor = favorForKingdom(world, settlement.kingdomId)
  if (
    !contract.meta.campaign &&
    contract.meta.peaceDividendOpportunity !== true &&
    favor >= 8 &&
    rng.chance(favor >= 16 ? 0.45 : 0.22)
  ) {
    contract = createExclusiveContractForKingdom(world, settlement, rng, level, favor, hasWar, underSiege)
  }
  contract = applyCourtFactionContractFlavor(world, settlement, contract)
  return applyCourtPatronage(world, contract, rng)
}

const hasOpenCampaignChain = (world: World, kingdomId: string): boolean =>
  Object.values(world.contracts).some(
    (contract) =>
      contract.issuerKingdomId === kingdomId &&
      contract.status !== 'completed' &&
      contract.status !== 'expired' &&
      Boolean(contract.meta.campaignChainId),
  )

const normalizeKind = (kind: Contract['kind']): Contract['kind'] =>
  kind === 'deliver_food' ||
  kind === 'hunt_bandits' ||
  kind === 'escort_caravan' ||
  kind === 'defend_settlement'
    ? kind
    : 'deliver_food'

const createContractByKind = (
  world: World,
  settlement: Settlement,
  kind: Contract['kind'],
  level: number,
  rng: SeededRng,
): Contract => {
  const normalized = normalizeKind(kind)
  if (normalized === 'deliver_food') return createFoodDeliveryContract(world, settlement, rng, level)
  if (normalized === 'hunt_bandits') return createBanditHuntContract(world, settlement, rng, level)
  if (normalized === 'escort_caravan') return createEscortContract(world, settlement, rng, level)
  return createDefendContract(world, settlement, rng, level)
}

const settlementsForKingdom = (world: World, kingdomId: string): Settlement[] =>
  Object.values(world.settlements).filter((settlement) => settlement.kingdomId === kingdomId)

const campaignBranchForKingdom = (world: World, kingdomId: string): 'relief' | 'frontier' | 'prosperity' => {
  const hasWar = Object.keys(world.kingdomConflicts).some((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === kingdomId || right === kingdomId
  })
  if (hasWar) return 'frontier'
  const settlements = settlementsForKingdom(world, kingdomId)
  const avgFoodStress =
    settlements.length > 0
      ? settlements.reduce((sum, settlement) => sum + settlement.meta.foodStress, 0) / settlements.length
      : 0
  return avgFoodStress > 24 ? 'relief' : 'prosperity'
}

const buildCampaignChainKinds = (
  branch: 'relief' | 'frontier' | 'prosperity',
): [Contract['kind'], Contract['kind'], Contract['kind']] => {
  if (branch === 'frontier') return ['defend_settlement', 'hunt_bandits', 'escort_caravan']
  if (branch === 'relief') return ['deliver_food', 'escort_caravan', 'defend_settlement']
  return ['escort_caravan', 'deliver_food', 'hunt_bandits']
}

const applyCampaignChainOutcome = (
  world: World,
  kingdomId: string,
  branch: 'relief' | 'frontier' | 'prosperity',
  messages: string[],
): void => {
  const settlements = settlementsForKingdom(world, kingdomId)
  if (branch === 'relief') {
    for (const settlement of settlements) {
      settlement.meta.foodStress = clamp(settlement.meta.foodStress - 8, 0, 100)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + 4, 0, 100)
    }
    messages.push(`${world.kingdoms[kingdomId].name} completed a relief campaign and eased shortages.`)
    return
  }
  if (branch === 'frontier') {
    for (const settlement of settlements) {
      settlement.meta.siegePressure = clamp(settlement.meta.siegePressure - 10, 0, 100)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + 3, 0, 100)
    }
    messages.push(`${world.kingdoms[kingdomId].name} completed a frontier campaign and secured its borders.`)
    return
  }
  for (const settlement of settlements) {
    settlement.treasury += 18
    settlement.meta.prosperity = clamp(settlement.meta.prosperity + 5, 0, 100)
  }
  messages.push(`${world.kingdoms[kingdomId].name} completed a prosperity campaign and boosted commerce.`)
}

const spawnCampaignChain = (
  world: World,
  kingdomId: string,
  rng: SeededRng,
): { created: boolean; message?: string } => {
  if (hasOpenCampaignChain(world, kingdomId)) return { created: false }
  const settlements = settlementsForKingdom(world, kingdomId)
  if (settlements.length < 2) return { created: false }

  const capital = capitalSettlementForKingdom(world, kingdomId)
  if (!capital) return { created: false }

  const branch = campaignBranchForKingdom(world, kingdomId)
  const kinds = buildCampaignChainKinds(branch)
  const sortedByNeed = [...settlements].sort((a, b) => b.meta.foodStress - a.meta.foodStress)
  const sortedByThreat = [...settlements].sort((a, b) => b.meta.siegePressure - a.meta.siegePressure)
  const stageSettlements: Settlement[] = [
    branch === 'relief' ? sortedByNeed[0] : branch === 'frontier' ? sortedByThreat[0] : capital,
    branch === 'relief' ? capital : branch === 'frontier' ? capital : sortedByNeed[0],
    branch === 'frontier' ? sortedByNeed[0] : sortedByThreat[0] ?? capital,
  ]

  const chainId = `campaign-${kingdomId}-${world.turn}-${rng.int(100, 999)}`
  const baseLevel = clamp(3 + Math.floor((world.campaignProgress[kingdomId] ?? 0) / 6), 3, 4)

  for (let stage = 0; stage < 3; stage += 1) {
    const settlement = stageSettlements[stage] ?? capital
    const contract = applyCourtFactionContractFlavor(
      world,
      settlement,
      createContractByKind(world, settlement, kinds[stage], baseLevel, rng),
    )
    contract.meta.campaign = true
    contract.meta.campaignChainId = chainId
    contract.meta.campaignStage = stage + 1
    contract.meta.campaignTotalStages = 3
    contract.meta.campaignBranch = branch
    contract.meta.locked = stage > 0
    contract.meta.minReputation = clamp(10 + baseLevel * 3 + stage * 6, 10, 70)
    contract.rewardReputation += 2 + stage
    contract.rewardBountyReduction += 2 + stage
    contract.rewardGoods.gold_ore = (contract.rewardGoods.gold_ore ?? 0) + (stage >= 1 ? 1 : 0)
    if (stage > 0) {
      contract.status = 'available'
    }
    world.contracts[contract.id] = contract
  }

  return {
    created: true,
    message: `${world.kingdoms[kingdomId].name} initiated a royal ${branch} campaign chain.`,
  }
}

const hasOpenDiplomaticSummitChainForPair = (world: World, pairKey: string): boolean =>
  Object.values(world.contracts).some(
    (contract) =>
      contract.status !== 'completed' &&
      contract.status !== 'expired' &&
      contract.meta.diplomaticSummitChainId === pairKey,
  )

const createDiplomaticSummitContract = (
  world: World,
  settlement: Settlement,
  kind: Contract['kind'],
  level: number,
  rng: SeededRng,
): Contract => {
  const flavored = applyCourtFactionContractFlavor(
    world,
    settlement,
    createContractByKind(world, settlement, kind, level, rng),
  )
  flavored.rewardReputation += 2
  flavored.rewardBountyReduction += 2
  flavored.meta.minReputation = clamp(Math.max(Number(flavored.meta.minReputation ?? 0), 12) + 2, 10, 70)
  return flavored
}

const spawnDiplomaticSummitChain = (
  world: World,
  issuerKingdomId: string,
  partnerKingdomId: string,
  rng: SeededRng,
): { created: boolean; message?: string } => {
  const pairKey = kingdomPairKey(issuerKingdomId, partnerKingdomId)
  if (hasOpenDiplomaticSummitChainForPair(world, pairKey)) return { created: false }

  const issuerCapital = capitalSettlementForKingdom(world, issuerKingdomId)
  if (!issuerCapital) return { created: false }
  if (contractCountForSettlement(world, issuerCapital.id) >= 4) return { created: false }

  const relation = relationBetween(world, issuerKingdomId, partnerKingdomId)
  const atWar = isAtWar(world, issuerKingdomId, partnerKingdomId)
  const level = clamp(
    2 +
      Math.floor((world.campaignProgress[issuerKingdomId] ?? 0) / 5) +
      (atWar ? 1 : 0) +
      (relation <= -25 ? 1 : 0),
    1,
    4,
  )

  const chainId = `diplomatic-${pairKey}-${world.turn}-${rng.int(100, 999)}`
  const stageKinds: [Contract['kind'], Contract['kind']] =
    atWar || relation <= -25 ? ['defend_settlement', 'escort_caravan'] : ['deliver_food', 'escort_caravan']

  const stage1 = createDiplomaticSummitContract(world, issuerCapital, stageKinds[0], level, rng)
  const stage2 = createDiplomaticSummitContract(world, issuerCapital, stageKinds[1], clamp(level + 1, 1, 4), rng)

  stage1.meta.diplomaticSummit = true
  stage1.meta.diplomaticSummitChainId = chainId
  stage1.meta.diplomaticPartnerKingdomId = partnerKingdomId
  stage1.meta.diplomaticPairKey = pairKey
  stage1.meta.diplomaticStage = 1
  stage1.meta.diplomaticTotalStages = 2
  stage1.meta.locked = false
  stage1.meta.courtDirective = `Diplomatic Summit Accord`
  stage1.meta.minFavor = clamp(Math.max(Number(stage1.meta.minFavor ?? 0), 8), 8, 26)

  stage2.meta.diplomaticSummit = true
  stage2.meta.diplomaticSummitChainId = chainId
  stage2.meta.diplomaticPartnerKingdomId = partnerKingdomId
  stage2.meta.diplomaticPairKey = pairKey
  stage2.meta.diplomaticStage = 2
  stage2.meta.diplomaticTotalStages = 2
  stage2.meta.locked = true
  stage2.meta.courtDirective = `Diplomatic Summit Accord`
  stage2.meta.minFavor = clamp(Math.max(Number(stage2.meta.minFavor ?? 0), 10), 10, 28)
  stage2.rewardReputation += 3
  stage2.rewardBountyReduction += 2

  world.contracts[stage1.id] = stage1
  world.contracts[stage2.id] = stage2
  return {
    created: true,
    message: `${world.kingdoms[issuerKingdomId].name} opened a diplomatic summit chain with ${world.kingdoms[partnerKingdomId].name}.`,
  }
}

const hasOpenOppositionContractForSummitChain = (world: World, chainId: string): boolean =>
  Object.values(world.contracts).some(
    (contract) =>
      contract.status !== 'completed' &&
      contract.status !== 'expired' &&
      contract.meta.diplomaticOpposition === true &&
      contract.meta.linkedDiplomaticSummitChainId === chainId,
  )

const activePeaceDividendPair = (world: World, left: string, right: string) => {
  const leftPolicy = world.kingdoms[left]?.policy
  const rightPolicy = world.kingdoms[right]?.policy
  if (!leftPolicy || !rightPolicy) return undefined
  if (leftPolicy.peaceDividendPartnerKingdomId !== right) return undefined
  if (rightPolicy.peaceDividendPartnerKingdomId !== left) return undefined
  if (leftPolicy.peaceDividendUntilTurn < world.turn || rightPolicy.peaceDividendUntilTurn < world.turn) return undefined
  return { leftPolicy, rightPolicy }
}

const reinforcePeaceDividendFromContract = (world: World, contract: Contract): string[] => {
  if (contract.meta.peaceDividendOpportunity !== true) return []
  const partner = contract.meta.peaceDividendPartnerKingdomId as string | undefined
  if (!partner || !world.kingdoms[partner]) return []
  if (isAtWar(world, contract.issuerKingdomId, partner)) return []
  const pair = activePeaceDividendPair(world, contract.issuerKingdomId, partner)
  if (!pair) return []

  const relationBoost = 2 + Math.floor(contract.level / 2)
  setRelation(
    world,
    contract.issuerKingdomId,
    partner,
    relationBetween(world, contract.issuerKingdomId, partner) + relationBoost,
  )

  const intensityBoost = clamp(2 + Math.floor(contract.level / 2), 1, 8)
  pair.leftPolicy.peaceDividendIntensity = clamp(pair.leftPolicy.peaceDividendIntensity + intensityBoost, 0, 100)
  pair.rightPolicy.peaceDividendIntensity = clamp(pair.rightPolicy.peaceDividendIntensity + intensityBoost, 0, 100)
  const extension = 2 + Math.floor(contract.level / 2)
  pair.leftPolicy.peaceDividendUntilTurn = Math.max(
    pair.leftPolicy.peaceDividendUntilTurn,
    world.turn + extension,
  )
  pair.rightPolicy.peaceDividendUntilTurn = Math.max(
    pair.rightPolicy.peaceDividendUntilTurn,
    world.turn + extension,
  )
  return ['Peace-dividend corridor strengthened by successful boom-time commission.']
}

const strainPeaceDividendFromFailedContract = (world: World, contract: Contract): string[] => {
  if (contract.meta.peaceDividendOpportunity !== true) return []
  const partner = contract.meta.peaceDividendPartnerKingdomId as string | undefined
  if (!partner || !world.kingdoms[partner]) return []
  const pair = activePeaceDividendPair(world, contract.issuerKingdomId, partner)
  if (!pair) return []

  const intensityLoss = clamp(3 + Math.floor(contract.level / 2), 2, 9)
  pair.leftPolicy.peaceDividendIntensity = clamp(pair.leftPolicy.peaceDividendIntensity - intensityLoss, 0, 100)
  pair.rightPolicy.peaceDividendIntensity = clamp(pair.rightPolicy.peaceDividendIntensity - intensityLoss, 0, 100)
  setRelation(
    world,
    contract.issuerKingdomId,
    partner,
    relationBetween(world, contract.issuerKingdomId, partner) - Math.max(1, Math.floor(intensityLoss / 2)),
  )
  if (pair.leftPolicy.peaceDividendIntensity <= 2 || pair.rightPolicy.peaceDividendIntensity <= 2) {
    pair.leftPolicy.peaceDividendIntensity = 0
    pair.rightPolicy.peaceDividendIntensity = 0
    pair.leftPolicy.peaceDividendUntilTurn = -1
    pair.rightPolicy.peaceDividendUntilTurn = -1
    pair.leftPolicy.peaceDividendPartnerKingdomId = 'none'
    pair.rightPolicy.peaceDividendPartnerKingdomId = 'none'
    return ['Peace dividend momentum collapsed after failed boom-time contracts.']
  }
  return ['Peace dividend momentum faltered after a failed boom-time contract.']
}

const createDiplomaticOppositionContract = (
  world: World,
  summitContract: Contract,
  type: 'war_hawk_sabotage' | 'reformer_counterpressure',
  rng: SeededRng,
): Contract | undefined => {
  const issuer = world.settlements[summitContract.settlementId]
  if (!issuer || contractCountForSettlement(world, issuer.id) >= 4) return undefined
  const partnerKingdomId = summitContract.meta.diplomaticPartnerKingdomId as string | undefined
  if (!partnerKingdomId || !world.kingdoms[partnerKingdomId]) return undefined
  const baseLevel = clamp(Number(summitContract.level ?? 2), 1, 4)
  const level = clamp(baseLevel + (type === 'war_hawk_sabotage' ? 1 : 0), 1, 4)
  const chainId = summitContract.meta.diplomaticSummitChainId as string | undefined
  if (!chainId) return undefined

  let contract: Contract
  if (type === 'war_hawk_sabotage') {
    contract = createBanditHuntContract(world, issuer, rng, level)
    contract.requiredAmount = clamp(contract.requiredAmount + 1, 1, 4)
    contract.rewardBountyReduction += 2
    contract.rewardGoods.tools = (contract.rewardGoods.tools ?? 0) + 1
    contract.meta.courtFaction = 'war_hawks'
    contract.meta.rivalFaction = 'reformers'
    contract.meta.courtDirective = 'Suppress Peace Sabotage'
    contract.meta.minCourtFavor = clamp(8 + level, 8, 28)
  } else {
    contract = createFoodDeliveryContract(world, issuer, rng, level)
    contract.good = 'grain'
    contract.requiredAmount = clamp(contract.requiredAmount + 2, 6, 20)
    contract.rewardReputation += 2
    contract.rewardGoods.vegetables = (contract.rewardGoods.vegetables ?? 0) + 2
    contract.meta.courtFaction = 'reformers'
    contract.meta.rivalFaction = 'war_hawks'
    contract.meta.courtDirective = 'Public Pressure for Peace'
    contract.meta.minCourtFavor = clamp(7 + level, 7, 26)
  }

  contract.meta.diplomaticOpposition = true
  contract.meta.oppositionType = type
  contract.meta.linkedDiplomaticSummitChainId = chainId
  contract.meta.diplomaticSummit = true
  contract.meta.diplomaticPartnerKingdomId = partnerKingdomId
  contract.meta.diplomaticPairKey = summitContract.meta.diplomaticPairKey
  contract.meta.minReputation = clamp(Math.max(Number(contract.meta.minReputation ?? 0), 10), 8, 70)
  return contract
}

export const seedInitialContracts = (world: World, rng: SeededRng): void => {
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier === 'hamlet') continue
    if (contractCountForSettlement(world, settlement.id) >= 1) continue
    const contract = createContractForSettlement(world, settlement, rng)
    world.contracts[contract.id] = contract
  }
}

export const simulateContractBoardTurn = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  for (const contract of Object.values(world.contracts)) {
    if (contract.status === 'completed' || contract.status === 'expired') continue
    if (world.turn > contract.expiresTurn) {
      const wasActive = contract.status === 'active'
      const campaignChainId = contract.meta.campaignChainId as string | undefined
      const summitChainId = contract.meta.summitChainId as string | undefined
      const diplomaticChainId = contract.meta.diplomaticSummitChainId as string | undefined
      const chainId = campaignChainId ?? summitChainId ?? diplomaticChainId
      contract.status = 'expired'
      if (contract.meta.campaign) {
        world.campaignProgress[contract.issuerKingdomId] = Math.max(
          0,
          (world.campaignProgress[contract.issuerKingdomId] ?? 0) - 1,
        )
      }
      if (chainId) {
        for (const sibling of Object.values(world.contracts)) {
          if (sibling.id === contract.id) continue
          if (sibling.status === 'completed' || sibling.status === 'expired') continue
          if (
            sibling.meta.campaignChainId === chainId ||
            sibling.meta.summitChainId === chainId ||
            sibling.meta.diplomaticSummitChainId === chainId
          ) {
            sibling.status = 'expired'
          }
        }
      }
      if (wasActive) {
        if (contract.assignedCharacterId === world.playerId) {
          addFavorForKingdom(world, contract.issuerKingdomId, -2)
          const faction = parseCourtFaction(contract.meta.courtFaction)
          if (contract.meta.truceIncident === true) {
            const pair = parseCourtFactionPair(contract.meta.trucePair)
            if (pair) {
              addCourtFavor(world, pair[0], -1)
              addCourtFavor(world, pair[1], -1)
            } else if (faction) {
              addCourtFavor(world, faction, -1)
            }
          } else {
            if (faction) addCourtFavor(world, faction, -1)
            const rivalFaction = parseCourtFaction(contract.meta.rivalFaction)
            if (rivalFaction && rivalFaction !== faction) addCourtFavor(world, rivalFaction, 1)
          }
        }
        messages.push(`Contract ${contract.id} expired before completion.`)
        if (campaignChainId) {
          messages.push('A royal campaign chain collapsed after missing critical objectives.')
        }
        if (summitChainId) {
          const policy = world.kingdoms[contract.issuerKingdomId]?.policy
          if (policy) {
            policy.factionTension = clamp(policy.factionTension + 10, 0, 100)
            if (policy.factionTrucePair !== 'none' && policy.factionTruceUntilTurn >= world.turn) {
              policy.factionTrucePair = 'none'
              policy.factionTruceUntilTurn = -1
            }
          }
          messages.push('A faction truce summit chain collapsed after mandates failed.')
        }
        if (diplomaticChainId) {
          const partner = contract.meta.diplomaticPartnerKingdomId as string | undefined
          if (partner) {
            const relation = relationBetween(world, contract.issuerKingdomId, partner)
            setRelation(world, contract.issuerKingdomId, partner, relation - 8)
          }
          messages.push('A diplomatic summit chain collapsed and tensions rose again.')
        }
        if (contract.meta.diplomaticOpposition === true) {
          const partner = contract.meta.diplomaticPartnerKingdomId as string | undefined
          if (partner) {
            const relation = relationBetween(world, contract.issuerKingdomId, partner)
            const loss = contract.meta.oppositionType === 'war_hawk_sabotage' ? 6 : 4
            setRelation(world, contract.issuerKingdomId, partner, relation - loss)
          }
          messages.push('Peace-opposition mandate failed, straining summit diplomacy.')
        }
        messages.push(...strainPeaceDividendFromFailedContract(world, contract))
      }
    }
  }

  if (world.turn % 10 === 0) {
    for (const kingdomId of Object.keys(world.kingdoms)) {
      const progress = world.campaignProgress[kingdomId] ?? 0
      if (progress < 4) continue
      const chainResult = spawnCampaignChain(world, kingdomId, rng)
      if (chainResult.created && chainResult.message) {
        messages.push(chainResult.message)
      }
    }
  }

  if (world.turn % 12 === 0) {
    const pairKeys = Object.keys(world.kingdomRelations)
    for (const pairKey of pairKeys) {
      const [left, right] = pairKey.split('|')
      if (!left || !right) continue
      if (hasOpenDiplomaticSummitChainForPair(world, pairKey)) continue
      const relation = relationBetween(world, left, right)
      const atWar = isAtWar(world, left, right)
      if (!atWar && relation > -6) continue
      const chance = atWar ? 0.45 : relation <= -28 ? 0.32 : 0.18
      if (!rng.chance(chance)) continue
      const issuer =
        (world.campaignProgress[left] ?? 0) >= (world.campaignProgress[right] ?? 0)
          ? left
          : right
      const partner = issuer === left ? right : left
      const summit = spawnDiplomaticSummitChain(world, issuer, partner, rng)
      if (summit.created && summit.message) messages.push(summit.message)
    }
  }

  if (world.turn % 9 === 0) {
    const summitLeads = new Map<string, Contract>()
    for (const contract of Object.values(world.contracts)) {
      if (contract.status !== 'available' && contract.status !== 'active') continue
      if (contract.meta.diplomaticSummit !== true) continue
      if (contract.meta.diplomaticOpposition === true) continue
      const chainId = contract.meta.diplomaticSummitChainId as string | undefined
      if (!chainId) continue
      const stage = Number(contract.meta.diplomaticStage ?? 1)
      const previous = summitLeads.get(chainId)
      const previousStage = Number(previous?.meta.diplomaticStage ?? 99)
      if (!previous || stage < previousStage) {
        summitLeads.set(chainId, contract)
      }
    }

    for (const [chainId, summit] of summitLeads.entries()) {
      if (hasOpenOppositionContractForSummitChain(world, chainId)) continue
      const partnerKingdomId = summit.meta.diplomaticPartnerKingdomId as string | undefined
      const issuerPolicy = world.kingdoms[summit.issuerKingdomId]?.policy
      const partnerPolicy = partnerKingdomId ? world.kingdoms[partnerKingdomId]?.policy : undefined
      if (!issuerPolicy || !partnerPolicy) continue
      const hawkPressure =
        (issuerPolicy.courtFaction === 'war_hawks' ? 2 : 0) +
        (partnerPolicy.courtFaction === 'war_hawks' ? 2 : 0) +
        (issuerPolicy.factionTension >= 55 ? 1 : 0) +
        (partnerPolicy.factionTension >= 55 ? 1 : 0)
      const reformerPressure =
        (issuerPolicy.courtFaction === 'reformers' ? 2 : 0) +
        (partnerPolicy.courtFaction === 'reformers' ? 2 : 0) +
        (issuerPolicy.factionTension >= 52 ? 1 : 0) +
        (partnerPolicy.factionTension >= 52 ? 1 : 0)
      const dominant = Math.max(hawkPressure, reformerPressure)
      if (dominant <= 0) continue
      const type: 'war_hawk_sabotage' | 'reformer_counterpressure' =
        hawkPressure >= reformerPressure ? 'war_hawk_sabotage' : 'reformer_counterpressure'
      const chance = clamp(0.2 + dominant * 0.07 + Math.abs(hawkPressure - reformerPressure) * 0.05, 0.22, 0.7)
      if (!rng.chance(chance)) continue
      const opposition = createDiplomaticOppositionContract(world, summit, type, rng)
      if (!opposition) continue
      world.contracts[opposition.id] = opposition
      messages.push(
        type === 'war_hawk_sabotage'
          ? 'War hawks are undermining a diplomatic summit. Counter-mandates posted.'
          : 'Reformers launched public pressure mandates to protect peace talks.',
      )
    }
  }

  if (world.turn % 6 !== 0) return messages
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier === 'hamlet') continue
    if (contractCountForSettlement(world, settlement.id) >= 2) continue
    if (!rng.chance(0.45)) continue
    const contract = createContractForSettlement(world, settlement, rng)
    world.contracts[contract.id] = contract
    messages.push(
      `${settlement.name} posted a new ${
        contract.kind === 'deliver_food'
          ? 'food'
          : contract.kind === 'escort_caravan'
            ? 'escort'
            : contract.kind === 'defend_settlement'
              ? 'defense'
              : 'security'
      } contract.`,
    )
  }

  return messages
}

const rewardPlayerForContract = (world: World, contract: Contract): void => {
  const player = world.characters[world.playerId]
  player.reputation += contract.rewardReputation
  player.meta.bounty = Math.max(0, Number(player.meta.bounty ?? 0) - contract.rewardBountyReduction)
  world.campaignProgress[contract.issuerKingdomId] =
    (world.campaignProgress[contract.issuerKingdomId] ?? 0) + (contract.meta.campaign ? 2 : 1)
  const favorGain = (contract.meta.campaign ? 2 : 1) + Math.floor(contract.level / 2) + (contract.meta.exclusive ? 1 : 0)
  addFavorForKingdom(world, contract.issuerKingdomId, favorGain)
  const faction = parseCourtFaction(contract.meta.courtFaction)
  if (contract.meta.truceIncident === true) {
    const pair = parseCourtFactionPair(contract.meta.trucePair)
    const truceGain =
      1 +
      Math.floor(contract.level / 2) +
      (contract.meta.courtPatronage ? 1 : 0)
    if (pair) {
      addCourtFavor(world, pair[0], truceGain)
      addCourtFavor(world, pair[1], truceGain)
    } else if (faction) {
      addCourtFavor(world, faction, truceGain)
    }
  } else if (contract.meta.diplomaticOpposition === true) {
    const partner = contract.meta.diplomaticPartnerKingdomId as string | undefined
    if (partner) {
      const relation = relationBetween(world, contract.issuerKingdomId, partner)
      const gain = contract.meta.oppositionType === 'war_hawk_sabotage' ? 7 : 5
      setRelation(world, contract.issuerKingdomId, partner, relation + gain)
      const updated = relationBetween(world, contract.issuerKingdomId, partner)
      if (isAtWar(world, contract.issuerKingdomId, partner) && updated >= -4) {
        setWarState(world, contract.issuerKingdomId, partner, false)
      }
    }
  } else {
    if (faction) {
      const courtGain =
        1 +
        Math.floor(contract.level / 2) +
        (contract.meta.courtPatronage ? 1 : 0) +
        (contract.meta.campaign ? 1 : 0)
      addCourtFavor(world, faction, courtGain)
    }
    const rivalFaction = parseCourtFaction(contract.meta.rivalFaction)
    if (rivalFaction && rivalFaction !== faction) {
      addCourtFavor(world, rivalFaction, -1)
    }
  }
  for (const [good, qty] of Object.entries(contract.rewardGoods) as [Good, number][]) {
    if (!qty || qty <= 0) continue
    player.inventory[good] = (player.inventory[good] ?? 0) + qty
  }
  const current = relationBetween(world, contract.issuerKingdomId, contract.issuerKingdomId)
  void current
  for (const otherId of Object.keys(world.kingdoms)) {
    if (otherId === contract.issuerKingdomId) continue
    const relation = relationBetween(world, contract.issuerKingdomId, otherId)
    if (relation < 0) {
      setRelation(world, contract.issuerKingdomId, otherId, relation + 1)
      break
    }
  }
}

const handleCampaignChainProgress = (world: World, contract: Contract): string[] => {
  const chainId = contract.meta.campaignChainId as string | undefined
  const stage = Number(contract.meta.campaignStage ?? 0)
  const total = Number(contract.meta.campaignTotalStages ?? 0)
  if (!chainId || stage <= 0 || total <= 0) return []

  const next = Object.values(world.contracts).find(
    (candidate) =>
      candidate.meta.campaignChainId === chainId &&
      Number(candidate.meta.campaignStage ?? 0) === stage + 1 &&
      candidate.status === 'available',
  )
  if (next) {
    next.meta.locked = false
    return [`Campaign stage ${stage} complete. Stage ${stage + 1} is now unlocked.`]
  }

  if (stage >= total) {
    const branch = (contract.meta.campaignBranch as 'relief' | 'frontier' | 'prosperity' | undefined) ?? 'prosperity'
    const outcomeMessages: string[] = []
    applyCampaignChainOutcome(world, contract.issuerKingdomId, branch, outcomeMessages)
    world.campaignProgress[contract.issuerKingdomId] =
      (world.campaignProgress[contract.issuerKingdomId] ?? 0) + 2
    const branchMessage =
      branch === 'relief'
        ? 'Relief'
        : branch === 'frontier'
          ? 'Frontier'
          : 'Prosperity'
    return [
      `Royal ${branchMessage} campaign chain completed for ${world.kingdoms[contract.issuerKingdomId].name}.`,
      ...outcomeMessages,
    ]
  }
  return []
}

const handleSummitChainProgress = (world: World, contract: Contract): string[] => {
  const chainId = contract.meta.summitChainId as string | undefined
  const stage = Number(contract.meta.summitStage ?? 0)
  const total = Number(contract.meta.summitTotalStages ?? 0)
  if (!chainId || stage <= 0 || total <= 0) return []

  const next = Object.values(world.contracts).find(
    (candidate) =>
      candidate.meta.summitChainId === chainId &&
      Number(candidate.meta.summitStage ?? 0) === stage + 1 &&
      candidate.status === 'available',
  )
  if (next) {
    next.meta.locked = false
    return [`Summit mandate stage ${stage} complete. Stage ${stage + 1} is now unlocked.`]
  }

  if (stage >= total) {
    const policy = world.kingdoms[contract.issuerKingdomId]?.policy
    const pair = parseCourtFactionPair(contract.meta.trucePair)
    if (policy) {
      policy.factionTension = clamp(policy.factionTension - 16, 0, 100)
      policy.courtStability = clamp(policy.courtStability + 6, 0, 100)
      if (policy.factionTrucePair !== 'none' && policy.factionTruceUntilTurn >= world.turn) {
        policy.factionTrucePair = 'none'
        policy.factionTruceUntilTurn = -1
      }
    }
    if (pair) {
      addCourtFavor(world, pair[0], 2)
      addCourtFavor(world, pair[1], 2)
      return [
        `Truce summit chain completed for ${world.kingdoms[contract.issuerKingdomId].name}.`,
        `${COURT_DIRECTIVE_BY_FACTION[pair[0]]} and ${COURT_DIRECTIVE_BY_FACTION[pair[1]]} standing improved.`,
      ]
    }
    return [`Truce summit chain completed for ${world.kingdoms[contract.issuerKingdomId].name}.`]
  }
  return []
}

const handleDiplomaticSummitChainProgress = (world: World, contract: Contract): string[] => {
  const chainId = contract.meta.diplomaticSummitChainId as string | undefined
  const stage = Number(contract.meta.diplomaticStage ?? 0)
  const total = Number(contract.meta.diplomaticTotalStages ?? 0)
  if (!chainId || stage <= 0 || total <= 0) return []

  const next = Object.values(world.contracts).find(
    (candidate) =>
      candidate.meta.diplomaticSummitChainId === chainId &&
      Number(candidate.meta.diplomaticStage ?? 0) === stage + 1 &&
      candidate.status === 'available',
  )
  if (next) {
    next.meta.locked = false
    return [`Diplomatic summit stage ${stage} complete. Stage ${stage + 1} is now unlocked.`]
  }

  if (stage >= total) {
    const partner = contract.meta.diplomaticPartnerKingdomId as string | undefined
    if (!partner) return []
    const currentRelation = relationBetween(world, contract.issuerKingdomId, partner)
    const boost = 12 + Math.floor(contract.level / 2)
    setRelation(world, contract.issuerKingdomId, partner, currentRelation + boost)
    const updated = relationBetween(world, contract.issuerKingdomId, partner)
    if (isAtWar(world, contract.issuerKingdomId, partner) && updated >= -6) {
      setWarState(world, contract.issuerKingdomId, partner, false)
    }
    const issuerPolicy = world.kingdoms[contract.issuerKingdomId]?.policy
    const partnerPolicy = world.kingdoms[partner]?.policy
    const dividendUntil = world.turn + 20
    const dividendIntensity = clamp(10 + contract.level * 3, 6, 40)
    if (issuerPolicy) {
      issuerPolicy.peaceDividendUntilTurn = Math.max(issuerPolicy.peaceDividendUntilTurn, dividendUntil)
      issuerPolicy.peaceDividendPartnerKingdomId = partner
      issuerPolicy.peaceDividendIntensity = Math.max(issuerPolicy.peaceDividendIntensity, dividendIntensity)
    }
    if (partnerPolicy) {
      partnerPolicy.peaceDividendUntilTurn = Math.max(partnerPolicy.peaceDividendUntilTurn, dividendUntil)
      partnerPolicy.peaceDividendPartnerKingdomId = contract.issuerKingdomId
      partnerPolicy.peaceDividendIntensity = Math.max(partnerPolicy.peaceDividendIntensity, dividendIntensity)
    }
    return [
      `Diplomatic summit chain completed between ${world.kingdoms[contract.issuerKingdomId].name} and ${world.kingdoms[partner].name}.`,
      `Relations improved to ${updated}.`,
      'A peace dividend is now boosting cross-border commerce.',
    ]
  }
  return []
}

const handleContractChainProgress = (world: World, contract: Contract): string[] => [
  ...handleCampaignChainProgress(world, contract),
  ...handleSummitChainProgress(world, contract),
  ...handleDiplomaticSummitChainProgress(world, contract),
]

const spawnEscortCaravan = (world: World, contract: Contract, rng: SeededRng): string | undefined => {
  const origin = world.settlements[contract.settlementId]
  const destinationId = contract.meta.destinationSettlementId as string | undefined
  const destination = destinationId ? world.settlements[destinationId] : undefined
  if (!origin || !destination) return undefined
  const originTile = origin.tiles[0]
  const destinationTile = destination.tiles[0]
  const path = shortestPath(world, originTile, destinationTile)
  if (path.length < 2) return undefined
  const good = contract.good ?? 'grain'
  const id = `escort-trader-${world.turn}-${rng.int(100, 999)}`
  world.characters[id] = {
    id,
    name: `Escort Caravan ${rng.int(10, 99)}`,
    role: 'trader',
    species: 'human',
    hp: 9,
    maxHp: 9,
    ap: 4,
    maxAp: 4,
    age: rng.int(20, 46),
    skills: { travel: 5, barter: 4, combat: 2 },
    history: [`Commissioned at ${origin.name} for escorted route.`],
    traits: ['cautious'],
    flaws: ['fragile'],
    reputation: 0,
    location: originTile,
    homeSettlementId: destination.id,
    targetTileId: destinationTile,
    alive: true,
    inventory: {
      [good]: contract.requiredAmount,
    },
    meta: {
      homeSettlementId: destination.id,
      sourceSettlementId: origin.id,
      contractId: contract.id,
      state: 'toHome',
      good,
      qty: contract.requiredAmount,
      travelPath: path,
      pathIndex: 0,
    },
  }
  return id
}

export const acceptContractForPlayer = (world: World, contractId: string): string[] => {
  const contract = world.contracts[contractId]
  const player = world.characters[world.playerId]
  const rng = new SeededRng(world.seed + world.turn * 29 + contractId.length)
  if (!contract) return ['Contract not found.']
  if (contract.status !== 'available') return ['That contract is no longer available.']
  if (contract.meta.locked) return ['This contract stage is locked until previous campaign objectives are done.']
  const minFavor = Number(contract.meta.minFavor ?? 0)
  if (minFavor > 0 && favorForKingdom(world, contract.issuerKingdomId) < minFavor) {
    return [`This contract requires kingdom favor ${minFavor}.`]
  }
  const minReputation = Number(contract.meta.minReputation ?? 0)
  if (minReputation > 0 && player.reputation < minReputation) {
    const neededTitle = campaignRankTitleForReputation(minReputation)
    return [
      `This contract requires reputation ${minReputation} (${neededTitle}). Your reputation is ${player.reputation}.`,
    ]
  }
  if (
    contract.meta.minCourtFavorByFaction &&
    typeof contract.meta.minCourtFavorByFaction === 'object'
  ) {
    const requirements = contract.meta.minCourtFavorByFaction as Record<string, unknown>
    for (const [rawFaction, rawMinimum] of Object.entries(requirements)) {
      const faction = parseCourtFaction(rawFaction)
      const minimum = Number(rawMinimum)
      if (!faction || !Number.isFinite(minimum) || minimum <= 0) continue
      const standing = courtFavorForFaction(world, faction)
      if (standing < minimum) {
        return [`This contract requires ${COURT_DIRECTIVE_BY_FACTION[faction]} standing ${minimum}. Current: ${standing}.`]
      }
    }
  }
  const minCourtFavor = Number(contract.meta.minCourtFavor ?? 0)
  if (minCourtFavor > 0) {
    const faction = parseCourtFaction(contract.meta.courtFaction)
    if (!faction) return ['This contract has invalid court patronage requirements.']
    const courtStanding = courtFavorForFaction(world, faction)
    if (courtStanding < minCourtFavor) {
      const factionName = COURT_DIRECTIVE_BY_FACTION[faction]
      return [`This contract requires ${factionName} standing ${minCourtFavor}. Current: ${courtStanding}.`]
    }
  }
  if (activeContractForPlayer(world)) return ['You already have an active contract.']
  if (player.ap < 1) return ['Not enough AP to accept a contract.']
  const settlement = world.settlements[contract.settlementId]
  if (!settlement) return ['Contract issuer settlement is missing.']
  if (player.location !== settlement.tiles[0]) return ['Travel to the issuing settlement first.']

  player.ap -= 1
  contract.status = 'active'
  contract.assignedCharacterId = player.id
  contract.acceptedTurn = world.turn
  if (contract.kind === 'hunt_bandits') {
    contract.meta.startBanditKills = Number(player.meta.banditsDefeated ?? 0)
  } else if (contract.kind === 'defend_settlement') {
    contract.meta.startHostileKills = Number(player.meta.hostilesDefeated ?? 0)
  } else if (contract.kind === 'escort_caravan') {
    const caravanId = spawnEscortCaravan(world, contract, rng)
    if (!caravanId) {
      contract.status = 'available'
      contract.assignedCharacterId = undefined
      return ['Unable to prepare caravan route for this escort contract.']
    }
    contract.meta.caravanId = caravanId
    contract.meta.playerMetCaravan = false
    contract.meta.caravanDelivered = false
  }
  const messages = [`You accepted contract ${contract.id} at ${settlement.name}.`]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const progressActiveContractForPlayer = (world: World): string[] => {
  const contract = activeContractForPlayer(world)
  const player = world.characters[world.playerId]
  if (!contract) return ['You have no active contract.']
  const settlement = world.settlements[contract.settlementId]
  if (!settlement) return ['Contract settlement no longer exists.']
  if (player.location !== settlement.tiles[0]) return ['Return to the issuing settlement to report progress.']

  if (contract.kind === 'deliver_food') {
    const good = contract.good
    if (!good) return ['This food contract is invalid.']
    const remaining = Math.max(0, contract.requiredAmount - contract.progress)
    if (remaining <= 0) {
      contract.status = 'completed'
      rewardPlayerForContract(world, contract)
      const dividendMessages = reinforcePeaceDividendFromContract(world, contract)
      const chainMessages = handleContractChainProgress(world, contract)
      return [`Contract ${contract.id} was already complete and has now been closed.`, ...dividendMessages, ...chainMessages]
    }
    const available = Math.floor(player.inventory[good] ?? 0)
    if (available <= 0) return [`Bring ${good} to complete this contract.`]
    const delivered = Math.min(remaining, available)
    player.inventory[good] = available - delivered
    settlement.stockpile[good] += delivered
    contract.progress += delivered
    if (contract.progress >= contract.requiredAmount) {
      contract.status = 'completed'
      rewardPlayerForContract(world, contract)
      settlement.meta.foodStress = clamp(settlement.meta.foodStress - 10, 0, 100)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + 6, 0, 100)
      const dividendMessages = reinforcePeaceDividendFromContract(world, contract)
      const messages = [
        `Contract ${contract.id} completed by delivering ${contract.requiredAmount} ${good}.`,
        ...dividendMessages,
        ...handleContractChainProgress(world, contract),
      ]
      world.messages = [...messages, ...world.messages].slice(0, 120)
      return messages
    }
    const remainingAfter = contract.requiredAmount - contract.progress
    const messages = [`Delivered ${delivered} ${good}. ${remainingAfter} more required.`]
    world.messages = [...messages, ...world.messages].slice(0, 120)
    return messages
  }

  if (contract.kind === 'hunt_bandits') {
    const startKills = Number(contract.meta.startBanditKills ?? 0)
    const nowKills = Number(player.meta.banditsDefeated ?? 0)
    contract.progress = Math.max(0, nowKills - startKills)
    if (contract.progress >= contract.requiredAmount) {
      contract.status = 'completed'
      rewardPlayerForContract(world, contract)
      const dividendMessages = reinforcePeaceDividendFromContract(world, contract)
      const messages = [
        `Contract ${contract.id} completed. The roads feel safer.`,
        ...dividendMessages,
        ...handleContractChainProgress(world, contract),
      ]
      world.messages = [...messages, ...world.messages].slice(0, 120)
      return messages
    }
    return [`Bandits defeated: ${contract.progress}/${contract.requiredAmount}. Keep hunting.`]
  }

  if (contract.kind === 'defend_settlement') {
    const startKills = Number(contract.meta.startHostileKills ?? 0)
    const nowKills = Number(player.meta.hostilesDefeated ?? 0)
    contract.progress = Math.max(0, nowKills - startKills)
    if (contract.progress >= contract.requiredAmount) {
      contract.status = 'completed'
      rewardPlayerForContract(world, contract)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + 4, 0, 100)
      const dividendMessages = reinforcePeaceDividendFromContract(world, contract)
      const messages = [
        `Contract ${contract.id} completed. ${settlement.name} defenses held strong.`,
        ...dividendMessages,
        ...handleContractChainProgress(world, contract),
      ]
      world.messages = [...messages, ...world.messages].slice(0, 120)
      return messages
    }
    return [`Hostile threats defeated: ${contract.progress}/${contract.requiredAmount}.`]
  }

  if (contract.kind === 'escort_caravan') {
    const caravanId = contract.meta.caravanId as string | undefined
    const met = Boolean(contract.meta.playerMetCaravan)
    const delivered = Boolean(contract.meta.caravanDelivered)
    if (delivered && met) {
      contract.progress = contract.requiredAmount
      contract.status = 'completed'
      rewardPlayerForContract(world, contract)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity + 5, 0, 100)
      const dividendMessages = reinforcePeaceDividendFromContract(world, contract)
      const messages = [
        `Contract ${contract.id} completed. Escort caravan reached destination safely.`,
        ...dividendMessages,
        ...handleContractChainProgress(world, contract),
      ]
      world.messages = [...messages, ...world.messages].slice(0, 120)
      return messages
    }
    if (!caravanId || !world.characters[caravanId]?.alive) {
      contract.status = 'expired'
      return ['Escort contract failed: caravan was lost or destroyed.']
    }
    if (!met) return ['Locate and accompany the caravan before reporting completion.']
    if (!delivered) return ['Escort objective underway. Ensure the caravan reaches its destination.']
  }

  return ['Contract type is unsupported.']
}

