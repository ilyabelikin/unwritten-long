import { keyFor, neighborsOf } from '../hex'
import { SeededRng } from '../random'
import type { Character, World } from '../types'
import { clamp } from '../utils'

const peaceDividendShieldForSettlement = (world: World, settlementId: string): number => {
  const settlement = world.settlements[settlementId]
  const policy = world.kingdoms[settlement.kingdomId]?.policy
  if (!policy) return 0
  if (policy.peaceDividendUntilTurn < world.turn) return 0
  return clamp(policy.peaceDividendIntensity / 100, 0, 0.5)
}

const hostileScore = (actor: Character): number => {
  if (!actor.alive) return 0
  if (actor.role === 'monster') return 2.2
  if (actor.role === 'bandit') return actor.meta.warPair ? 1.9 : 1.2
  if (actor.role === 'wildlife' && ['bear', 'wolf', 'boar'].includes(actor.species)) return 0.5
  return 0
}

const settlementInfluenceTiles = (world: World, settlementId: string): Set<string> => {
  const settlement = world.settlements[settlementId]
  const tiles = new Set<string>()
  for (const tileId of settlement.tiles) {
    tiles.add(tileId)
    const tile = world.tiles[tileId]
    for (const neighbor of neighborsOf(tile.coord)) {
      const neighborId = keyFor(neighbor.q, neighbor.r)
      if (world.tiles[neighborId] && world.tiles[neighborId].terrain !== 'sea') {
        tiles.add(neighborId)
      }
    }
  }
  return tiles
}

export const simulateSiegePressure = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier !== 'city' && settlement.tier !== 'town') {
      settlement.meta.siegePressure = clamp(settlement.meta.siegePressure * 0.85 - 1, 0, 100)
      continue
    }

    const zone = settlementInfluenceTiles(world, settlement.id)
    let hostile = 0
    for (const actor of Object.values(world.characters)) {
      if (!zone.has(actor.location)) continue
      hostile += hostileScore(actor)
    }

    const before = settlement.meta.siegePressure
    const peaceShield = peaceDividendShieldForSettlement(world, settlement.id)
    const pressureScale = 1 - peaceShield
    const delta = hostile * 1.8 * pressureScale - 1.2
    settlement.meta.siegePressure = clamp(settlement.meta.siegePressure + delta, 0, 100)
    if (settlement.meta.siegePressure > 0 && hostile > 0) {
      const lootLoss = Math.min(3, Math.ceil((hostile / 2) * pressureScale))
      settlement.stockpile.grain = Math.max(0, settlement.stockpile.grain - lootLoss)
      settlement.stockpile.fish = Math.max(0, settlement.stockpile.fish - Math.round(rng.int(0, 1) * pressureScale))
      settlement.meta.foodStress = clamp(settlement.meta.foodStress + hostile * 0.8 * pressureScale, 0, 100)
      settlement.meta.prosperity = clamp(settlement.meta.prosperity - hostile * 0.4 * pressureScale, 0, 100)
    }

    if (before < 35 && settlement.meta.siegePressure >= 35) {
      messages.push(`${settlement.name} reports growing siege pressure on its outskirts.`)
    }
    if (before < 65 && settlement.meta.siegePressure >= 65) {
      messages.push(`${settlement.name} is under severe siege pressure and requests urgent relief.`)
    }
    if (before >= 35 && settlement.meta.siegePressure < 20) {
      messages.push(`${settlement.name} has stabilized local defenses for now.`)
    }
  }
  return messages
}

