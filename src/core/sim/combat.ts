import { keyFor, neighborsOf, parseKey } from '../hex'
import { SeededRng } from '../random'
import type { Character, World } from '../types'
import { effectiveGuardHostilityBounty, effectiveGuardHostilityReputation } from './edicts'
import { guardLeniencyFromPeaceCorridor } from './peaceCorridor'

const attackPower = (actor: Character): number => {
  const combat = actor.skills.combat ?? 1
  const roleBonus =
    actor.role === 'guard'
      ? 3
      : actor.role === 'monster'
        ? 4
        : actor.role === 'bandit'
          ? 2
          : actor.role === 'player'
            ? 2
            : actor.role === 'wildlife' && (actor.species === 'bear' || actor.species === 'wolf')
              ? 2
              : 0
  return 2 + combat * 0.7 + roleBonus
}

const nearestCityTile = (world: World, fromTileId: string): string | undefined => {
  const from = parseKey(fromTileId)
  let best: { tileId: string; distance: number } | undefined
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier !== 'city') continue
    const center = settlement.tiles[0]
    const target = parseKey(center)
    const dist = Math.abs(from.q - target.q) + Math.abs(from.r - target.r)
    if (!best || dist < best.distance) {
      best = { tileId: center, distance: dist }
    }
  }
  return best?.tileId
}

const resolveDefeat = (world: World, target: Character, attacker: Character, rng: SeededRng): string => {
  if (target.hp > 0) return ''
  if (target.role === 'wildlife' || target.role === 'monster' || target.role === 'bandit') {
    target.alive = false
    if (attacker.id === world.playerId) {
      if (target.role === 'bandit') {
        attacker.meta.banditsDefeated = Number(attacker.meta.banditsDefeated ?? 0) + 1
      }
      if (target.role === 'bandit' || target.role === 'monster') {
        attacker.meta.hostilesDefeated = Number(attacker.meta.hostilesDefeated ?? 0) + 1
      }
    }
    return `${attacker.name} killed ${target.name}.`
  }

  const miracle = rng.chance(0.4)
  if (miracle) {
    const rescueTile = nearestCityTile(world, target.location)
    target.hp = Math.ceil(target.maxHp * 0.45)
    if (rescueTile) target.location = rescueTile
    target.history.push(`Miraculously survived defeat by ${attacker.name}.`)
    return `${target.name} survived and awoke in a nearby city.`
  }

  if (target.id === world.playerId) {
    target.hp = Math.ceil(target.maxHp * 0.5)
    const rescueTile = nearestCityTile(world, target.location)
    if (rescueTile) target.location = rescueTile
    target.history.push('Fate spared them from death and sent them to a city.')
    return 'You should have died, but fate dragged you to a nearby city.'
  }

  target.alive = false
  target.history.push(`Died in battle against ${attacker.name}.`)
  return `${target.name} died in battle.`
}

const inventoryValue = (character: Character): number =>
  Object.values(character.inventory).reduce((total, qty) => total + (qty ?? 0), 0)

const plunderDefeatedTarget = (
  world: World,
  attacker: Character,
  target: Character,
  rng: SeededRng,
  wasDefeated: boolean,
): string[] => {
  if (!wasDefeated) return []
  const messages: string[] = []

  if (target.id === world.playerId && (attacker.role === 'bandit' || attacker.role === 'monster')) {
    const stolenRate = attacker.role === 'bandit' ? 0.55 : 0.35
    const stolen: [string, number][] = []
    for (const [good, qty] of Object.entries(target.inventory)) {
      if (!qty || qty <= 0) continue
      const take = Math.min(qty, Math.ceil(qty * stolenRate))
      if (take <= 0) continue
      target.inventory[good as keyof typeof target.inventory] = Math.max(0, qty - take)
      stolen.push([good, take])
      if (attacker.role === 'bandit') {
        attacker.inventory[good as keyof typeof attacker.inventory] =
          (attacker.inventory[good as keyof typeof attacker.inventory] ?? 0) + take
      }
    }
    if (stolen.length > 0) {
      messages.push(
        `${attacker.name} stole ${stolen.map(([good, qty]) => `${qty} ${good}`).join(', ')} from the player.`,
      )
    }
    return messages
  }

  if (!['bandit', 'player', 'monster'].includes(attacker.role)) return messages
  const lootEntries = Object.entries(target.inventory).filter(([, qty]) => (qty ?? 0) > 0)
  if (lootEntries.length === 0) return messages

  for (const [good, qty] of lootEntries) {
    if (!qty || qty <= 0) continue
    attacker.inventory[good as keyof typeof attacker.inventory] =
      (attacker.inventory[good as keyof typeof attacker.inventory] ?? 0) + qty
    target.inventory[good as keyof typeof target.inventory] = 0
  }
  messages.push(
    `${attacker.name} looted ${lootEntries.map(([good, qty]) => `${qty} ${good}`).join(', ')} from ${target.name}.`,
  )

  if (target.role === 'trader') {
    const homeId = target.meta.homeSettlementId as string | undefined
    const home = homeId ? world.settlements[homeId] : undefined
    if (home) {
      const loss = Math.max(4, Math.round(inventoryValue(attacker) * 0.3))
      home.treasury = Math.max(0, home.treasury - loss)
      home.meta.foodStress = Math.min(100, home.meta.foodStress + 3 + rng.int(0, 3))
      messages.push(`${home.name} suffered caravan losses worth ${loss} silver.`)
    }
  }

  if (attacker.role === 'player' && target.role === 'trader') {
    attacker.reputation -= 8
  }

  return messages
}

export const performAttack = (
  world: World,
  attackerId: string,
  targetId: string,
  rng: SeededRng,
): string[] => {
  const attacker = world.characters[attackerId]
  const target = world.characters[targetId]
  if (!attacker || !target || !attacker.alive || !target.alive) return []
  if (attacker.location !== target.location) return []

  const messages: string[] = []
  const damage = Math.max(1, Math.round(attackPower(attacker) + rng.int(0, 3) - (target.skills.combat ?? 1) * 0.2))
  target.hp -= damage
  const wasDefeated = target.hp <= 0
  messages.push(`${attacker.name} hit ${target.name} for ${damage}.`)
  if (attacker.role === 'player' && target.role !== 'monster' && target.role !== 'wildlife') {
    attacker.reputation -= 1
  }
  const defeatMessage = resolveDefeat(world, target, attacker, rng)
  if (defeatMessage) messages.push(defeatMessage)
  messages.push(...plunderDefeatedTarget(world, attacker, target, rng, wasDefeated))
  return messages
}

export const isAggressiveTowards = (actor: Character, target: Character, world: World): boolean => {
  if (!actor.alive || !target.alive || actor.id === target.id) return false
  if (actor.location !== target.location) return false
  if (actor.role === 'guard' && target.id === world.playerId) {
    const guardCityId = actor.meta.guardCityId as string | undefined
    const guardKingdomId = guardCityId ? world.settlements[guardCityId]?.kingdomId : actor.homeSettlementId
      ? world.settlements[actor.homeSettlementId]?.kingdomId
      : undefined
    const legalPolicy = guardKingdomId ? world.kingdoms[guardKingdomId]?.policy : undefined
    const manhuntKingdom = target.meta.manhuntKingdomId as string | undefined
    const manhuntExpiresTurn = Number(target.meta.manhuntExpiresTurn ?? -1)
    const manhuntActive = manhuntKingdom === guardKingdomId && manhuntExpiresTurn >= world.turn
    const corridorLeniency = guardLeniencyFromPeaceCorridor(world, guardKingdomId)
    const repThreshold = legalPolicy
      ? effectiveGuardHostilityReputation(legalPolicy, manhuntActive) - corridorLeniency.reputation
      : -20
    const bountyThreshold = legalPolicy
      ? effectiveGuardHostilityBounty(legalPolicy, manhuntActive) + corridorLeniency.bounty
      : 20
    const bounty = Number(target.meta.bounty ?? 0)
    return target.reputation <= repThreshold || bounty >= bountyThreshold
  }
  if (actor.role === 'bandit') return target.role === 'trader' || target.id === world.playerId
  if (actor.role === 'monster') return target.species !== actor.species
  if (actor.role === 'wildlife') {
    if (actor.species === 'wolf' || actor.species === 'bear' || actor.species === 'boar') {
      return target.species !== actor.species
    }
  }
  return false
}

export const healInCities = (world: World): void => {
  for (const char of Object.values(world.characters)) {
    if (!char.alive) continue
    const tile = world.tiles[char.location]
    if (!tile?.settlementId) continue
    const settlement = world.settlements[tile.settlementId]
    if (!settlement || settlement.tier !== 'city') continue
    char.hp = char.maxHp
  }
}

export const cityGuardSpawnTiles = (world: World): string[] => {
  const tiles: string[] = []
  for (const settlement of Object.values(world.settlements)) {
    if (settlement.tier !== 'city') continue
    tiles.push(...settlement.tiles)
    for (const tileId of settlement.tiles) {
      const tile = world.tiles[tileId]
      for (const n of neighborsOf(tile.coord)) {
        const neighborId = keyFor(n.q, n.r)
        if (world.tiles[neighborId] && world.tiles[neighborId].terrain !== 'sea') tiles.push(neighborId)
      }
    }
  }
  return [...new Set(tiles)]
}

