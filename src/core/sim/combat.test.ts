import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { isAggressiveTowards, performAttack } from './combat'

describe('combat plunder outcomes', () => {
  it('bandits plunder caravans and hurt settlement treasury', () => {
    const world = generateWorld(7701)
    const settlement = Object.values(world.settlements)[0]
    const tileId = settlement.tiles[0]
    const treasuryBefore = settlement.treasury

    world.characters['test-trader'] = {
      id: 'test-trader',
      name: 'Test Trader',
      role: 'trader',
      species: 'human',
      hp: 1,
      maxHp: 8,
      ap: 4,
      maxAp: 4,
      age: 30,
      skills: { combat: 1, barter: 5 },
      history: [],
      traits: ['careful'],
      flaws: ['frail'],
      reputation: 0,
      location: tileId,
      homeSettlementId: settlement.id,
      targetTileId: undefined,
      alive: true,
      inventory: { grain: 8 },
      meta: { homeSettlementId: settlement.id },
    }
    world.characters['test-bandit'] = {
      id: 'test-bandit',
      name: 'Test Bandit',
      role: 'bandit',
      species: 'human',
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 28,
      skills: { combat: 7 },
      history: [],
      traits: ['ruthless'],
      flaws: ['greedy'],
      reputation: -40,
      location: tileId,
      targetTileId: undefined,
      alive: true,
      inventory: {},
      meta: {},
    }

    const messages = performAttack(world, 'test-bandit', 'test-trader', new SeededRng(5))
    expect(world.characters['test-bandit'].inventory.grain).toBeGreaterThan(0)
    expect(world.characters['test-trader'].inventory.grain).toBe(0)
    expect(settlement.treasury).toBeLessThanOrEqual(treasuryBefore)
    expect(messages.some((line) => line.includes('looted'))).toBe(true)
  })

  it('player loses some inventory when downed by bandits', () => {
    const world = generateWorld(7702)
    const player = world.characters[world.playerId]
    const tileId = player.location
    player.hp = 1
    player.inventory = { grain: 10, tools: 4 }

    world.characters['test-bandit'] = {
      id: 'test-bandit',
      name: 'Road Bandit',
      role: 'bandit',
      species: 'human',
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 25,
      skills: { combat: 6 },
      history: [],
      traits: ['ruthless'],
      flaws: ['greedy'],
      reputation: -35,
      location: tileId,
      targetTileId: undefined,
      alive: true,
      inventory: {},
      meta: {},
    }

    performAttack(world, 'test-bandit', world.playerId, new SeededRng(7))
    expect((player.inventory.grain ?? 0) + (player.inventory.tools ?? 0)).toBeLessThan(14)
    expect(world.characters['test-bandit'].inventory.grain ?? 0).toBeGreaterThan(0)
  })

  it('guards use kingdom legal thresholds for player hostility', () => {
    const world = generateWorld(7703)
    const guard = Object.values(world.characters).find((character) => character.role === 'guard')
    expect(guard).toBeDefined()
    if (!guard) return
    const guardSettlementId = guard.homeSettlementId ?? (guard.meta.guardCityId as string | undefined)
    expect(guardSettlementId).toBeDefined()
    if (!guardSettlementId) return
    const kingdomId = world.settlements[guardSettlementId].kingdomId
    const policy = world.kingdoms[kingdomId].policy
    const player = world.characters[world.playerId]
    player.location = guard.location
    player.reputation = 0
    player.meta.bounty = 0

    policy.guardHostilityReputation = -30
    policy.guardHostilityBounty = 40
    expect(isAggressiveTowards(guard, player, world)).toBe(false)

    policy.guardHostilityReputation = 2
    expect(isAggressiveTowards(guard, player, world)).toBe(true)

    policy.guardHostilityReputation = -30
    policy.guardHostilityBounty = 40
    player.reputation = -23
    player.meta.bounty = 14
    player.meta.manhuntKingdomId = kingdomId
    player.meta.manhuntExpiresTurn = world.turn + 8
    expect(isAggressiveTowards(guard, player, world)).toBe(true)
  })

  it('active peace corridors make guards more lenient to minor offenders', () => {
    const world = generateWorld(7704)
    const guard = Object.values(world.characters).find((character) => character.role === 'guard')
    expect(guard).toBeDefined()
    if (!guard) return
    const guardSettlementId = guard.homeSettlementId ?? (guard.meta.guardCityId as string | undefined)
    expect(guardSettlementId).toBeDefined()
    if (!guardSettlementId) return
    const kingdomId = world.settlements[guardSettlementId].kingdomId
    const partnerId = Object.keys(world.kingdoms).find((id) => id !== kingdomId)
    expect(partnerId).toBeDefined()
    if (!partnerId) return
    const player = world.characters[world.playerId]
    player.location = guard.location
    player.reputation = -17
    player.meta.bounty = 17
    const policy = world.kingdoms[kingdomId].policy
    policy.guardHostilityReputation = -16
    policy.guardHostilityBounty = 16

    expect(isAggressiveTowards(guard, player, world)).toBe(true)

    world.kingdoms[kingdomId].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[partnerId].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[kingdomId].policy.peaceDividendPartnerKingdomId = partnerId
    world.kingdoms[partnerId].policy.peaceDividendPartnerKingdomId = kingdomId
    world.kingdoms[kingdomId].policy.peaceDividendIntensity = 24
    world.kingdoms[partnerId].policy.peaceDividendIntensity = 24
    world.kingdomConflicts[[kingdomId, partnerId].sort().join('|')] = false
    world.kingdomRelations[[kingdomId, partnerId].sort().join('|')] = 12

    expect(isAggressiveTowards(guard, player, world)).toBe(false)
  })
})

