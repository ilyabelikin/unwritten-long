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
})

