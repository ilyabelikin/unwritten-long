import { keyFor, neighborsOf } from '../../core/hex'
import { activePeaceCorridorForKingdom, corridorStatusForPair } from '../../core/sim/peaceCorridor'
import type { World } from '../../core/types'

export interface CorridorOverlayTile {
  mix: number
  tint: string
}

const tintForHealth = (health: string): string => {
  if (health === 'robust') return '#29b8a3'
  if (health === 'stable') return '#5fbe6a'
  if (health === 'fragile') return '#d0a147'
  if (health === 'critical') return '#ca684a'
  return '#4f6580'
}

export const corridorOverlayByTile = (world: World): Record<string, CorridorOverlayTile> => {
  const byTile: Record<string, CorridorOverlayTile> = {}
  const corridorByKingdom: Record<string, { partnerKingdomId: string; intensity: number; tint: string }> = {}

  for (const kingdomId of Object.keys(world.kingdoms)) {
    const corridor = activePeaceCorridorForKingdom(world, kingdomId)
    if (!corridor) continue
    const status = corridorStatusForPair(world, kingdomId, corridor.partnerKingdomId)
    if (!status.active || !status.stabilized) continue
    corridorByKingdom[kingdomId] = {
      partnerKingdomId: corridor.partnerKingdomId,
      intensity: corridor.intensity,
      tint: tintForHealth(status.health),
    }
  }

  for (const tileId of world.tileOrder) {
    const tile = world.tiles[tileId]
    if (!tile.kingdomId) continue
    const corridor = corridorByKingdom[tile.kingdomId]
    if (!corridor) continue
    let score = corridor.intensity * 0.32
    if (tile.road) score += corridor.intensity * 0.42
    if (tile.settlementId) score += corridor.intensity * 0.24
    const borderTouch = neighborsOf(tile.coord).some((neighbor) => {
      const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
      return neighborTile?.kingdomId === corridor.partnerKingdomId
    })
    if (borderTouch) score += corridor.intensity * 0.3
    byTile[tileId] = { mix: Math.min(1, score / 100), tint: corridor.tint }
  }

  return byTile
}
