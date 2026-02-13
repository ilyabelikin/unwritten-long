import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { setRelation, setWarState } from './diplomacy'
import { trySpawnWarRefugee } from './events'

describe('world events under conflict', () => {
  it('can spawn refugees when kingdoms are at war', () => {
    const world = generateWorld(9310)
    const kingdomIds = Object.keys(world.kingdoms)
    const left = kingdomIds[0]
    const right = kingdomIds[1]
    setRelation(world, left, right, -80)
    setWarState(world, left, right, true)
    world.turn = 14
    const message = trySpawnWarRefugee(world, new SeededRng(5), [left, right].sort().join('|'))
    const refugeeSpawned = Object.values(world.characters).some(
      (character) => character.role === 'migrant' && Boolean(character.meta.refugeeFromConflict),
    )
    expect(message).toContain('War refugees fled')
    expect(refugeeSpawned).toBe(true)
  })
})

