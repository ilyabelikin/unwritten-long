import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { relationBetween, simulateDiplomacyTurn } from './diplomacy'

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
})

