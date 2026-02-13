import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { simulateSiegePressure } from './siege'

describe('siege pressure simulation', () => {
  it('increases pressure when hostiles gather near a city', () => {
    const world = generateWorld(9510)
    const city = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(city).toBeDefined()
    if (!city) return
    const tileId = city.tiles[0]
    city.meta.siegePressure = 0

    world.characters['siege-monster'] = {
      id: 'siege-monster',
      name: 'Siege Ogre',
      role: 'monster',
      species: 'ogre',
      hp: 16,
      maxHp: 16,
      ap: 4,
      maxAp: 4,
      age: 9,
      skills: { combat: 6 },
      history: [],
      traits: ['aggressive'],
      flaws: ['reckless'],
      reputation: -30,
      location: tileId,
      alive: true,
      inventory: {},
      meta: {},
    }

    simulateSiegePressure(world, new SeededRng(10))
    expect(city.meta.siegePressure).toBeGreaterThan(0)
  })

  it('naturally decays pressure when no hostiles remain', () => {
    const world = generateWorld(9511)
    const city = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(city).toBeDefined()
    if (!city) return
    city.meta.siegePressure = 24

    for (let i = 0; i < 4; i += 1) {
      simulateSiegePressure(world, new SeededRng(20 + i))
    }
    expect(city.meta.siegePressure).toBeLessThan(24)
  })
})

