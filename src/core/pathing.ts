import { keyFor, neighborsOf, parseKey } from './hex'
import type { Tile, World } from './types'

const travelCost = (tile: Tile): number => {
  if (tile.terrain === 'sea') return Number.POSITIVE_INFINITY
  let cost = tile.terrain === 'mountain' || tile.vegetation === 'deep_forest' ? 2 : 1
  if (tile.rough && tile.terrain !== 'mountain' && tile.vegetation !== 'deep_forest') cost += 1
  if (tile.road) cost = Math.max(1, cost - 2)
  return cost
}

const findPath = (
  world: World,
  startId: string,
  goalId: string,
  extraTileCost?: (tileId: string) => number,
): string[] => {
  if (startId === goalId) return [startId]
  const open = new Set<string>([startId])
  const cameFrom: Record<string, string | undefined> = {}
  const gScore: Record<string, number> = { [startId]: 0 }
  const fScore: Record<string, number> = { [startId]: 0 }

  const pickLowest = (): string => {
    let best = startId
    let bestScore = Number.POSITIVE_INFINITY
    for (const id of open) {
      const score = fScore[id] ?? Number.POSITIVE_INFINITY
      if (score < bestScore) {
        best = id
        bestScore = score
      }
    }
    return best
  }

  const heuristic = (fromId: string, toId: string): number => {
    const from = parseKey(fromId)
    const to = parseKey(toId)
    return Math.abs(from.q - to.q) + Math.abs(from.r - to.r)
  }

  while (open.size > 0) {
    const current = pickLowest()
    if (current === goalId) {
      const path: string[] = [current]
      let cursor = current
      while (cameFrom[cursor]) {
        cursor = cameFrom[cursor]!
        path.unshift(cursor)
      }
      return path
    }
    open.delete(current)
    const currentCoord = parseKey(current)
    for (const neighborCoord of neighborsOf(currentCoord)) {
      const neighborId = keyFor(neighborCoord.q, neighborCoord.r)
      const tile = world.tiles[neighborId]
      if (!tile || tile.terrain === 'sea') continue
      const riskCost = Math.max(0, extraTileCost?.(neighborId) ?? 0)
      const candidate = (gScore[current] ?? Number.POSITIVE_INFINITY) + travelCost(tile) + riskCost
      if (candidate < (gScore[neighborId] ?? Number.POSITIVE_INFINITY)) {
        cameFrom[neighborId] = current
        gScore[neighborId] = candidate
        fScore[neighborId] = candidate + heuristic(neighborId, goalId)
        open.add(neighborId)
      }
    }
  }

  return [startId]
}

export const shortestPath = (world: World, startId: string, goalId: string): string[] =>
  findPath(world, startId, goalId)

export const safestPath = (
  world: World,
  startId: string,
  goalId: string,
  dangerByTile: Record<string, number>,
): string[] =>
  findPath(world, startId, goalId, (tileId) => {
    const danger = dangerByTile[tileId] ?? 0
    return Math.min(8, danger)
  })

