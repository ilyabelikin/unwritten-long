import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { seedInitialContracts, simulateContractBoardTurn } from './contracts'
import { playerAcceptContract, playerProgressContract } from './turn'

describe('contracts system', () => {
  it('allows player to accept and complete a food delivery contract', () => {
    const world = generateWorld(9410)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-food-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'deliver_food',
      level: 1,
      status: 'available',
      good: 'grain',
      requiredAmount: 5,
      progress: 0,
      rewardReputation: 5,
      rewardBountyReduction: 4,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.inventory.grain = 6
    const repBefore = player.reputation

    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted contract')
    expect(world.contracts[contractId].status).toBe('active')

    const progressed = playerProgressContract(world)
    expect(progressed[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
    expect(player.reputation).toBeGreaterThan(repBefore)
    expect((player.inventory.grain ?? 0)).toBeLessThan(6)
  })

  it('updates hunt contracts from player bandit kills', () => {
    const world = generateWorld(9411)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-hunt-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'hunt_bandits',
      level: 1,
      status: 'available',
      requiredAmount: 1,
      progress: 0,
      rewardReputation: 7,
      rewardBountyReduction: 6,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.meta.banditsDefeated = 0
    playerAcceptContract(world, contractId)
    player.meta.banditsDefeated = 1
    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })

  it('seeds and rotates contracts over time', () => {
    const world = generateWorld(9412)
    world.contracts = {}
    seedInitialContracts(world, new SeededRng(8))
    const initialCount = Object.keys(world.contracts).length
    expect(initialCount).toBeGreaterThan(0)

    world.turn = 12
    const messages = simulateContractBoardTurn(world, new SeededRng(9))
    expect(Object.keys(world.contracts).length).toBeGreaterThanOrEqual(initialCount)
    expect(messages.length).toBeGreaterThanOrEqual(0)
  })

  it('can complete defend-settlement contracts via hostile kill progress', () => {
    const world = generateWorld(9413)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-defend-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'defend_settlement',
      level: 2,
      status: 'available',
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 6,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.meta.hostilesDefeated = 0
    playerAcceptContract(world, contractId)
    player.meta.hostilesDefeated = 2
    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })

  it('can complete escort-caravan contracts after meeting and delivery', () => {
    const world = generateWorld(9414)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const destination = Object.values(world.settlements).find((candidate) => candidate.id !== settlementId)
    expect(destination).toBeDefined()
    if (!destination) return

    const contractId = `test-escort-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'escort_caravan',
      level: 2,
      status: 'available',
      requiredAmount: 8,
      progress: 0,
      rewardReputation: 9,
      rewardBountyReduction: 8,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 20,
      meta: { destinationSettlementId: destination.id },
    }

    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted contract')
    const caravanId = world.contracts[contractId].meta.caravanId as string
    expect(caravanId).toBeDefined()
    world.contracts[contractId].meta.playerMetCaravan = true
    world.contracts[contractId].meta.caravanDelivered = true
    if (world.characters[caravanId]) {
      world.characters[caravanId].alive = false
    }

    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })
})

