import { FOOD_GOODS } from '../constants'
import { shortestPath } from '../pathing'
import { SeededRng } from '../random'
import type { Contract, Good, Settlement, World } from '../types'
import { clamp } from '../utils'
import { relationBetween, setRelation } from './diplomacy'

const activeContractForPlayer = (world: World): Contract | undefined =>
  Object.values(world.contracts).find(
    (contract) => contract.status === 'active' && contract.assignedCharacterId === world.playerId,
  )

const newContractId = (world: World, prefix: string, rng: SeededRng): string =>
  `${prefix}-${world.turn}-${rng.int(100, 999)}-${Object.keys(world.contracts).length + 1}`

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
  if ((hasWar || underSiege) && settlement.tier !== 'hamlet' && rng.chance(underSiege ? 0.75 : 0.5)) {
    return createDefendContract(world, settlement, rng, level)
  }
  if (settlement.tier === 'city' && rng.chance(0.4)) {
    return createEscortContract(world, settlement, rng, level)
  }
  if (pressure) return createFoodDeliveryContract(world, settlement, rng, level)
  return createBanditHuntContract(world, settlement, rng, level)
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
      contract.status = 'expired'
      if (contract.meta.campaign) {
        world.campaignProgress[contract.issuerKingdomId] = Math.max(
          0,
          (world.campaignProgress[contract.issuerKingdomId] ?? 0) - 1,
        )
      }
      if (wasActive) {
        messages.push(`Contract ${contract.id} expired before completion.`)
      }
    }
  }

  if (world.turn % 10 === 0) {
    for (const kingdomId of Object.keys(world.kingdoms)) {
      const progress = world.campaignProgress[kingdomId] ?? 0
      if (progress < 4) continue
      const capital = capitalSettlementForKingdom(world, kingdomId)
      if (!capital) continue
      const existingCampaign = Object.values(world.contracts).some(
        (contract) =>
          contract.issuerKingdomId === kingdomId &&
          contract.status !== 'completed' &&
          contract.status !== 'expired' &&
          Boolean(contract.meta.campaign),
      )
      if (existingCampaign) continue

      const contract = rng.chance(0.5)
        ? createDefendContract(world, capital, rng, 4)
        : createEscortContract(world, capital, rng, 4)
      contract.meta.campaign = true
      contract.rewardReputation += 5
      contract.rewardBountyReduction += 5
      contract.rewardGoods.gold_ore = (contract.rewardGoods.gold_ore ?? 0) + 1
      world.contracts[contract.id] = contract
      messages.push(`${capital.name} issued a high-priority royal campaign contract.`)
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
      return [`Contract ${contract.id} was already complete and has now been closed.`]
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
      const messages = [`Contract ${contract.id} completed by delivering ${contract.requiredAmount} ${good}.`]
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
      const messages = [`Contract ${contract.id} completed. The roads feel safer.`]
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
      const messages = [`Contract ${contract.id} completed. ${settlement.name} defenses held strong.`]
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
      const messages = [`Contract ${contract.id} completed. Escort caravan reached destination safely.`]
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

