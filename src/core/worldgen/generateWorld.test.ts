import { describe, expect, it } from 'vitest'
import { generateWorld } from './generateWorld'
import { keyFor, neighborsOf } from '../hex'

describe('generateWorld', () => {
  it('creates a populated world with settlements and kingdoms', () => {
    const world = generateWorld(4242)
    const landTiles = world.tileOrder.filter((id) => world.tiles[id].terrain !== 'sea')
    const roadTiles = world.tileOrder.filter((id) => world.tiles[id].road)
    expect(landTiles.length).toBeGreaterThan(300)
    expect(Object.keys(world.settlements).length).toBeGreaterThanOrEqual(10)
    expect(Object.keys(world.kingdoms).length).toBe(3)
    expect(roadTiles.length).toBeGreaterThan(40)
  })

  it('keeps coast tiles adjacent to sea and resources plausible', () => {
    const world = generateWorld(8921)
    for (const tile of Object.values(world.tiles)) {
      if (tile.terrain === 'coast') {
        const adjacentSea = neighborsOf(tile.coord).some(
          (n) => world.tiles[keyFor(n.q, n.r)]?.terrain === 'sea',
        )
        expect(adjacentSea).toBe(true)
      }
      if (tile.resources.includes('gold_ore')) {
        expect(tile.terrain).toBe('mountain')
      }
      if (tile.resources.includes('fish')) {
        expect(tile.terrain).toBe('sea')
      }
    }
  })
})

