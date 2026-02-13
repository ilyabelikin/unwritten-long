import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { simulateWildlifeEcology } from './wildlife'

describe('wildlife ecology simulation', () => {
  it('predators attack prey sharing the same tile', () => {
    const world = generateWorld(8801)
    const tileId = Object.values(world.settlements)[0].tiles[0]
    world.characters['wolf-test'] = {
      id: 'wolf-test',
      name: 'wolf',
      role: 'wildlife',
      species: 'wolf',
      hp: 8,
      maxHp: 8,
      ap: 4,
      maxAp: 4,
      age: 4,
      skills: { combat: 6 },
      history: [],
      traits: ['aggressive'],
      flaws: ['impulsive'],
      reputation: -20,
      location: tileId,
      alive: true,
      inventory: {},
      meta: {},
    }
    world.characters['rabbit-test'] = {
      id: 'rabbit-test',
      name: 'rabbit',
      role: 'wildlife',
      species: 'rabbit',
      hp: 4,
      maxHp: 4,
      ap: 4,
      maxAp: 4,
      age: 2,
      skills: { combat: 1 },
      history: [],
      traits: ['skittish'],
      flaws: ['fragile'],
      reputation: -20,
      location: tileId,
      alive: true,
      inventory: {},
      meta: {},
    }

    const messages = simulateWildlifeEcology(world, new SeededRng(12))
    expect(world.characters['rabbit-test'].hp).toBeLessThan(4)
    expect(messages.some((line) => line.includes('wolf hit rabbit'))).toBe(true)
  })
})

