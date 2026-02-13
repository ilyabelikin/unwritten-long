import { describe, expect, it } from 'vitest'
import { safestPath } from './pathing'
import type { Tile, World } from './types'

const tile = (id: string, q: number, r: number): Tile => ({
  id,
  coord: { q, r },
  elevation: 1,
  terrain: 'plains',
  vegetation: 'none',
  resources: [],
  road: false,
  rough: false,
})

const createMiniWorld = (): World => ({
  seed: 1,
  width: 2,
  height: 2,
  tiles: {
    '0,0': tile('0,0', 0, 0),
    '1,0': tile('1,0', 1, 0),
    '0,1': tile('0,1', 0, 1),
    '1,1': tile('1,1', 1, 1),
  },
  tileOrder: ['0,0', '1,0', '0,1', '1,1'],
  settlements: {},
  characters: {
    player: {
      id: 'player',
      name: 'Player',
      role: 'player',
      species: 'human',
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 25,
      skills: {},
      history: [],
      traits: [],
      flaws: [],
      reputation: 0,
      location: '0,0',
      alive: true,
      inventory: {},
      meta: {},
    },
  },
  kingdoms: {},
  kingdomRelations: {},
  kingdomConflicts: {},
  campaignProgress: {},
  contracts: {},
  playerId: 'player',
  turn: 0,
  season: 'spring',
  seasonTurn: 0,
  messages: [],
})

describe('safestPath', () => {
  it('avoids tiles marked with high danger when alternatives exist', () => {
    const world = createMiniWorld()
    const danger = {
      '0,0': 0,
      '1,0': 7.5,
      '0,1': 0,
      '1,1': 0,
    }
    const path = safestPath(world, '0,0', '1,1', danger)
    expect(path).toEqual(['0,0', '0,1', '1,1'])
  })
})

