import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { advanceWorldTurn, determineSeasonFromTurn, movementCost } from './turn'

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
})

