import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import {
  advanceWorldTurn,
  determineSeasonFromTurn,
  movementCost,
  playerDonateSupplies,
  playerRob,
  playerSponsorTreaty,
} from './turn'
import { setRelation, setWarState } from './diplomacy'

describe('turn simulation', () => {
  it('advances season correctly every 60 turns', () => {
    expect(determineSeasonFromTurn(0).season).toBe('spring')
    expect(determineSeasonFromTurn(60).season).toBe('summer')
    expect(determineSeasonFromTurn(120).season).toBe('autumn')
    expect(determineSeasonFromTurn(180).season).toBe('winter')
  })

  it('advances world turn and refreshes player AP', () => {
    const world = generateWorld(101)
    const player = world.characters[world.playerId]
    player.ap = 0
    advanceWorldTurn(world, 3)
    expect(world.turn).toBe(1)
    expect(player.ap).toBe(player.maxAp)
    expect(world.messages.length).toBeGreaterThan(0)
  })

  it('movement on roads remains low cost', () => {
    const world = generateWorld(212)
    const roadTile = world.tileOrder.find((id) => world.tiles[id].road)!
    const neighborRoad = world.tileOrder.find((id) => {
      if (!world.tiles[id].road || id === roadTile) return false
      const from = world.tiles[roadTile].coord
      const to = world.tiles[id].coord
      return Math.abs(from.q - to.q) <= 1 && Math.abs(from.r - to.r) <= 1
    })
    if (!neighborRoad) return
    expect(movementCost(world, roadTile, neighborRoad)).toBe(1)
  })

  it('applies elevation and terrain movement modifiers', () => {
    const world = generateWorld(313)
    const start = world.tileOrder.find((id) => world.tiles[id].terrain !== 'sea')!
    const target = world.tileOrder.find((id) => id !== start && world.tiles[id].terrain !== 'sea')!

    world.tiles[start].road = false
    world.tiles[target].road = false
    world.tiles[start].elevation = 1
    world.tiles[target].elevation = 3
    world.tiles[target].terrain = 'plains'
    world.tiles[target].vegetation = 'none'
    world.tiles[target].rough = false
    expect(movementCost(world, start, target)).toBe(3)

    world.tiles[target].terrain = 'mountain'
    world.tiles[target].elevation = 2
    world.tiles[target].rough = true
    expect(movementCost(world, start, target)).toBe(3)
  })

  it('stays stable over many world turns', () => {
    const world = generateWorld(9088)
    for (let i = 0; i < 90; i += 1) {
      advanceWorldTurn(world, i)
    }
    const player = world.characters[world.playerId]
    expect(world.turn).toBe(90)
    expect(player.alive).toBe(true)
    for (const settlement of Object.values(world.settlements)) {
      expect(Number.isFinite(settlement.treasury)).toBe(true)
      expect(settlement.treasury).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(settlement.stockpile.grain)).toBe(true)
      expect(settlement.stockpile.grain).toBeGreaterThanOrEqual(0)
    }
  })

  it('applies bounty when robbery is confirmed', () => {
    const world = generateWorld(9091)
    const player = world.characters[world.playerId]
    world.characters['test-trader'] = {
      id: 'test-trader',
      name: 'Trade Wagon',
      role: 'trader',
      species: 'human',
      hp: 8,
      maxHp: 8,
      ap: 4,
      maxAp: 4,
      age: 30,
      skills: { barter: 5 },
      history: [],
      traits: ['pragmatic'],
      flaws: ['frail'],
      reputation: 0,
      location: player.location,
      homeSettlementId: Object.values(world.settlements)[0].id,
      targetTileId: undefined,
      alive: true,
      inventory: { fish: 4 },
      meta: { homeSettlementId: Object.values(world.settlements)[0].id },
    }

    const first = playerRob(world, 'test-trader', false)
    expect(first[0]).toContain('Confirm?')
    expect(world.pendingRobberyCharacterId).toBe('test-trader')

    const second = playerRob(world, 'test-trader', true)
    expect(second[0]).toContain('Bounty')
    expect(Number(player.meta.bounty ?? 0)).toBeGreaterThan(0)
  })

  it('donating supplies improves settlement morale and lowers bounty', () => {
    const world = generateWorld(9092)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    player.inventory.grain = 3
    player.inventory.fish = 1
    player.meta.bounty = 22
    const stressBefore = settlement.meta.foodStress
    const repBefore = player.reputation

    const messages = playerDonateSupplies(world)
    expect(messages[0]).toContain('donated')
    expect(settlement.meta.foodStress).toBeLessThanOrEqual(stressBefore)
    expect(player.reputation).toBeGreaterThan(repBefore)
    expect(Number(player.meta.bounty ?? 0)).toBeLessThan(22)
  })

  it('sponsoring treaty can improve relations and end war', () => {
    const world = generateWorld(9093)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const localKingdom = world.settlements[settlementId].kingdomId
    const foreign = Object.keys(world.kingdoms).find((id) => id !== localKingdom)
    expect(foreign).toBeDefined()
    if (!foreign) return

    setRelation(world, localKingdom, foreign, -12)
    setWarState(world, localKingdom, foreign, true)
    player.inventory.gold_ore = 2
    const before = world.kingdomRelations[[localKingdom, foreign].sort().join('|')]

    const messages = playerSponsorTreaty(world)
    const after = world.kingdomRelations[[localKingdom, foreign].sort().join('|')]
    expect(messages[0]).toContain('sponsored talks')
    expect(after).toBeGreaterThan(before)
    expect(world.kingdomConflicts[[localKingdom, foreign].sort().join('|')]).toBe(false)
  })
})

