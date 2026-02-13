import { FOOD_GOODS } from '../constants'
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

const createFoodDeliveryContract = (world: World, settlement: Settlement, rng: SeededRng): Contract => {
  const good = rng.pick(FOOD_GOODS)
  const need = settlement.needs[good] ?? 2
  const requiredAmount = clamp(Math.ceil(need * 1.3), 4, 14)
  return {
    id: newContractId(world, 'contract-food', rng),
    settlementId: settlement.id,
    issuerKingdomId: settlement.kingdomId,
    kind: 'deliver_food',
    status: 'available',
    good,
    requiredAmount,
    progress: 0,
    rewardReputation: 4 + Math.ceil(requiredAmount / 4),
    rewardBountyReduction: 4,
    rewardGoods: { tools: 1 },
    expiresTurn: world.turn + 28,
    meta: {},
  }
}

const createBanditHuntContract = (world: World, settlement: Settlement, rng: SeededRng): Contract => ({
  id: newContractId(world, 'contract-hunt', rng),
  settlementId: settlement.id,
  issuerKingdomId: settlement.kingdomId,
  kind: 'hunt_bandits',
  status: 'available',
  requiredAmount: 1,
  progress: 0,
  rewardReputation: 7,
  rewardBountyReduction: 8,
  rewardGoods: { gold_ore: 1, tools: 1 },
  expiresTurn: world.turn + 34,
  meta: {},
})

const contractCountForSettlement = (world: World, settlementId: string): number =>
  Object.values(world.contracts).filter(
    (contract) =>
      contract.settlementId === settlementId &&
      (contract.status === 'available' || contract.status === 'active'),
  ).length

export const seedInitialContracts = (world: World, rng: SeededRng): void => {
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier === 'hamlet') continue
    if (contractCountForSettlement(world, settlement.id) >= 1) continue
    const contract =
      settlement.meta.foodStress > 20 || settlement.needs.grain > settlement.stockpile.grain
        ? createFoodDeliveryContract(world, settlement, rng)
        : createBanditHuntContract(world, settlement, rng)
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
      if (wasActive) {
        messages.push(`Contract ${contract.id} expired before completion.`)
      }
    }
  }

  if (world.turn % 6 !== 0) return messages
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier === 'hamlet') continue
    if (contractCountForSettlement(world, settlement.id) >= 2) continue
    if (!rng.chance(0.45)) continue
    const pressure =
      settlement.meta.foodStress > 18 ||
      settlement.needs.grain + settlement.needs.fish > settlement.stockpile.grain + settlement.stockpile.fish
    const contract = pressure
      ? createFoodDeliveryContract(world, settlement, rng)
      : createBanditHuntContract(world, settlement, rng)
    world.contracts[contract.id] = contract
    messages.push(`${settlement.name} posted a new ${contract.kind === 'deliver_food' ? 'food' : 'security'} contract.`)
  }

  return messages
}

const rewardPlayerForContract = (world: World, contract: Contract): void => {
  const player = world.characters[world.playerId]
  player.reputation += contract.rewardReputation
  player.meta.bounty = Math.max(0, Number(player.meta.bounty ?? 0) - contract.rewardBountyReduction)
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

export const acceptContractForPlayer = (world: World, contractId: string): string[] => {
  const contract = world.contracts[contractId]
  const player = world.characters[world.playerId]
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

  return ['Contract type is unsupported.']
}

