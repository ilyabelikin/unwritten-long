import { describe, expect, it } from 'vitest'
import { generateWorld } from '../../core/worldgen/generateWorld'
import { setRelation, setWarState } from '../../core/sim/diplomacy'
import { corridorOverlayByTile } from './corridorOverlay'

describe('corridorOverlayByTile', () => {
  it('marks tiles in stabilized corridor kingdoms', () => {
    const world = generateWorld(10151)
    const [left, right, other] = Object.keys(world.kingdoms)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[left].policy.peaceDividendIntensity = 42
    world.kingdoms[right].policy.peaceDividendIntensity = 42
    setWarState(world, left, right, false)
    setRelation(world, left, right, 28)

    const overlay = corridorOverlayByTile(world)
    const highlightedLeft = world.tileOrder.filter(
      (tileId) => world.tiles[tileId].kingdomId === left && overlay[tileId]?.mix > 0,
    )
    const highlightedRight = world.tileOrder.filter(
      (tileId) => world.tiles[tileId].kingdomId === right && overlay[tileId]?.mix > 0,
    )

    expect(highlightedLeft.length).toBeGreaterThan(0)
    expect(highlightedRight.length).toBeGreaterThan(0)
    if (other) {
      const highlightedOther = world.tileOrder.filter(
        (tileId) => world.tiles[tileId].kingdomId === other && overlay[tileId]?.mix > 0,
      )
      expect(highlightedOther.length).toBe(0)
    }
  })

  it('omits corridor overlays when pair returns to war', () => {
    const world = generateWorld(10157)
    const [left, right] = Object.keys(world.kingdoms)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendIntensity = 36
    world.kingdoms[right].policy.peaceDividendIntensity = 36
    setRelation(world, left, right, 24)
    setWarState(world, left, right, true)

    const overlay = corridorOverlayByTile(world)
    const highlighted = Object.values(overlay)

    expect(highlighted.length).toBe(0)
  })
})
