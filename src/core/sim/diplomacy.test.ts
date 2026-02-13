import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { isAtWar, relationBetween, setRelation, simulateDiplomacyTurn } from './diplomacy'

describe('diplomacy simulation', () => {
  it('initializes relation entries for every kingdom pair', () => {
    const world = generateWorld(9901)
    const ids = Object.keys(world.kingdoms)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const relation = relationBetween(world, ids[i], ids[j])
        expect(Number.isFinite(relation)).toBe(true)
      }
    }
  })

  it('updates relations on diplomacy ticks', () => {
    const world = generateWorld(9902)
    world.turn = 12
    const ids = Object.keys(world.kingdoms)
    const before = relationBetween(world, ids[0], ids[1])
    simulateDiplomacyTurn(world, new SeededRng(24))
    const after = relationBetween(world, ids[0], ids[1])
    expect(after).not.toBe(before)
  })

  it('declares and resolves wars from relation thresholds', () => {
    const world = generateWorld(9903)
    const ids = Object.keys(world.kingdoms)
    const [left, right] = [ids[0], ids[1]]

    setRelation(world, left, right, -85)
    world.turn = 12
    simulateDiplomacyTurn(world, new SeededRng(3))
    expect(isAtWar(world, left, right)).toBe(true)

    setRelation(world, left, right, 55)
    world.turn = 24
    simulateDiplomacyTurn(world, new SeededRng(4))
    expect(isAtWar(world, left, right)).toBe(false)
  })

  it('assigns kingdom policy defaults', () => {
    const world = generateWorld(9904)
    for (const kingdom of Object.values(world.kingdoms)) {
      expect(kingdom.policy.taxRate).toBeGreaterThan(0)
      expect(kingdom.policy.patrolFocus).toBeGreaterThan(0)
      expect(['open', 'balanced', 'protectionist']).toContain(kingdom.policy.tradeStance)
    }
  })
})

