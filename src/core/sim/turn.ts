import { TURNS_PER_SEASON } from '../constants'
import { hexDistance, keyFor, neighborsOf, parseKey } from '../hex'
import { SeededRng } from '../random'
import type { Character, World } from '../types'
import { clamp } from '../utils'
import { performAttack, healInCities, isAggressiveTowards, cityGuardSpawnTiles } from './combat'
import { simulateEconomyTurn, estimateGoodPrice } from './economy'
import { spawnWorldEvents } from './events'

const seasonOrder: World['season'][] = ['spring', 'summer', 'autumn', 'winter']

export const determineSeasonFromTurn = (turn: number): { season: World['season']; seasonTurn: number } => {
  const cycle = turn % (TURNS_PER_SEASON * seasonOrder.length)
  const seasonIndex = Math.floor(cycle / TURNS_PER_SEASON)
  return {
    season: seasonOrder[seasonIndex],
    seasonTurn: cycle % TURNS_PER_SEASON,
  }
}

export const movementCost = (world: World, fromId: string, toId: string): number => {
  const from = world.tiles[fromId]
  const to = world.tiles[toId]
  if (!from || !to || to.terrain === 'sea') return Number.POSITIVE_INFINITY
  if (from.road && to.road) return 1
  let cost = to.terrain === 'mountain' || to.vegetation === 'deep_forest' ? 2 : 1
  const climb = Math.max(0, to.elevation - from.elevation)
  cost += climb
  if (to.rough && to.terrain !== 'mountain' && to.vegetation !== 'deep_forest') cost += 1
  return cost
}

const isNeighbor = (a: string, b: string): boolean => {
  const coord = parseKey(a)
  return neighborsOf(coord).some((n) => keyFor(n.q, n.r) === b)
}

export const moveCharacter = (world: World, id: string, toId: string): string => {
  const char = world.characters[id]
  if (!char || !char.alive) return 'Character is unavailable.'
  if (!isNeighbor(char.location, toId)) return 'You can only move to adjacent hexes.'
  const cost = movementCost(world, char.location, toId)
  if (!Number.isFinite(cost)) return 'That terrain cannot be crossed.'
  if (char.ap < cost) return `Not enough AP (needs ${cost}).`
  char.location = toId
  char.ap -= cost
  return `${char.name} moved (${cost} AP).`
}

const neighborsLand = (world: World, tileId: string): string[] => {
  const coord = parseKey(tileId)
  return neighborsOf(coord)
    .map((n) => keyFor(n.q, n.r))
    .filter((id) => world.tiles[id] && world.tiles[id].terrain !== 'sea')
}

const closestTile = (from: string, candidates: string[]): string | undefined => {
  if (candidates.length === 0) return undefined
  const fromCoord = parseKey(from)
  let best = candidates[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const dist = hexDistance(fromCoord, parseKey(candidate))
    if (dist < bestDistance) {
      bestDistance = dist
      best = candidate
    }
  }
  return best
}

const nearestHostileTarget = (world: World, actor: Character): Character | undefined => {
  const targets = Object.values(world.characters).filter(
    (target) =>
      target.alive &&
      target.id !== actor.id &&
      target.location === actor.location &&
      isAggressiveTowards(actor, target, world),
  )
  if (targets.length > 0) return targets[0]
  return undefined
}

const stepToward = (world: World, actor: Character, targetTile: string): string | undefined => {
  const options = neighborsLand(world, actor.location)
  if (options.length === 0) return undefined
  let best: { tileId: string; score: number } | undefined
  for (const option of options) {
    const score = hexDistance(parseKey(option), parseKey(targetTile)) + movementCost(world, actor.location, option)
    if (!best || score < best.score) best = { tileId: option, score }
  }
  return best?.tileId
}

const applyTraderDelivery = (world: World, trader: Character, messages: string[]): void => {
  if (trader.role !== 'trader') return
  const homeId = trader.meta.homeSettlementId as string | undefined
  if (!homeId) return
  const home = world.settlements[homeId]
  if (!home) return
  if (trader.location !== home.tiles[0]) return
  const good = trader.meta.good as keyof typeof home.stockpile
  const qty = Number(trader.meta.qty ?? 0)
  if (!good || qty <= 0) return
  const sellPrice = estimateGoodPrice(home, good, world.season)
  const payment = Math.min(home.treasury, sellPrice * qty)
  home.treasury -= payment
  home.stockpile[good] += qty
  trader.meta.state = 'finished'
  trader.alive = false
  messages.push(`${home.name} caravan delivered ${qty} ${good}.`)
}

const processNpcIntent = (world: World, actor: Character, rng: SeededRng, messages: string[]): void => {
  if (!actor.alive || actor.ap <= 0) return
  const player = world.characters[world.playerId]
  const sameTileTarget = nearestHostileTarget(world, actor)
  if (sameTileTarget) {
    actor.ap = Math.max(0, actor.ap - 2)
    messages.push(...performAttack(world, actor.id, sameTileTarget.id, rng))
    return
  }

  if (actor.role === 'trader') {
    const homeId = actor.meta.homeSettlementId as string | undefined
    const home = homeId ? world.settlements[homeId] : undefined
    const target = home?.tiles[0]
    if (target) {
      const step = stepToward(world, actor, target)
      if (step) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
      }
      applyTraderDelivery(world, actor, messages)
      return
    }
  }

  if (actor.role === 'migrant') {
    const targetSettlementId = actor.meta.targetSettlementId as string | undefined
    const target = targetSettlementId ? world.settlements[targetSettlementId]?.tiles[0] : undefined
    if (target) {
      const step = stepToward(world, actor, target)
      if (step) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
      }
      if (actor.location === target) {
        const settle = world.settlements[targetSettlementId!]
        actor.role = 'villager'
        actor.homeSettlementId = settle.id
        settle.populationIds.push(actor.id)
        actor.meta = {}
        messages.push(`${actor.name} joined ${settle.name}.`)
      }
      return
    }
  }

  if (actor.role === 'guard') {
    const guardTiles = new Set(cityGuardSpawnTiles(world))
    if (player.reputation < -20) {
      const nearPlayer = hexDistance(parseKey(actor.location), parseKey(player.location)) <= 4
      const target = nearPlayer ? player.location : actor.location
      const step = stepToward(world, actor, target)
      if (step && guardTiles.has(step)) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
      }
      return
    }
    const options = neighborsLand(world, actor.location).filter((id) => guardTiles.has(id))
    if (options.length > 0) {
      const choice = options[rng.int(0, options.length - 1)]
      const cost = movementCost(world, actor.location, choice)
      if (cost <= actor.ap) {
        actor.location = choice
        actor.ap -= cost
      }
    }
    return
  }

  if (actor.role === 'bandit') {
    const caravans = Object.values(world.characters).filter(
      (c) => c.alive && (c.role === 'trader' || c.id === world.playerId),
    )
    const target = caravans.sort(
      (a, b) =>
        hexDistance(parseKey(actor.location), parseKey(a.location)) -
        hexDistance(parseKey(actor.location), parseKey(b.location)),
    )[0]
    const targetTile = target?.location
    if (targetTile) {
      const step = stepToward(world, actor, targetTile)
      if (step) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
        return
      }
    }
  }

  if (actor.role === 'monster') {
    const targets = Object.values(world.settlements).map((s) => s.tiles[0])
    const nearestSettlementTile = closestTile(actor.location, targets)
    if (nearestSettlementTile) {
      const step = stepToward(world, actor, nearestSettlementTile)
      if (step) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
      }
      const tile = world.tiles[actor.location]
      if (tile.settlementId && rng.chance(0.3)) {
        const settlement = world.settlements[tile.settlementId]
        settlement.stockpile.grain = Math.max(0, settlement.stockpile.grain - rng.int(1, 3))
        settlement.stockpile.meat = Math.max(0, settlement.stockpile.meat - rng.int(0, 2))
        messages.push(`${actor.name} raided stores in ${settlement.name}.`)
      }
      return
    }
  }

  if (actor.role === 'wildlife') {
    if (actor.species === 'bear' && world.season === 'winter') {
      if (rng.chance(0.92)) return
      actor.meta.winterRage = true
      actor.skills.combat = clamp((actor.skills.combat ?? 5) + 1, 1, 10)
      messages.push('A winter bear has awakened and turned aggressive.')
    }
    const options = neighborsLand(world, actor.location)
    if (options.length > 0) {
      const choice = options[rng.int(0, options.length - 1)]
      const cost = movementCost(world, actor.location, choice)
      if (cost <= actor.ap) {
        actor.location = choice
        actor.ap -= cost
      }
    }
    return
  }

  const options = neighborsLand(world, actor.location)
  if (options.length > 0 && rng.chance(0.35)) {
    const choice = options[rng.int(0, options.length - 1)]
    const cost = movementCost(world, actor.location, choice)
    if (cost <= actor.ap) {
      actor.location = choice
      actor.ap -= cost
    }
  }
}

const resolveTileCombats = (world: World, rng: SeededRng, messages: string[]): void => {
  const byTile = new Map<string, string[]>()
  for (const char of Object.values(world.characters)) {
    if (!char.alive) continue
    if (!byTile.has(char.location)) byTile.set(char.location, [])
    byTile.get(char.location)!.push(char.id)
  }

  for (const ids of byTile.values()) {
    for (const attackerId of ids) {
      const attacker = world.characters[attackerId]
      if (!attacker?.alive) continue
      const target = ids
        .map((id) => world.characters[id])
        .find((other) => other && isAggressiveTowards(attacker, other, world))
      if (!target) continue
      messages.push(...performAttack(world, attacker.id, target.id, rng))
    }
  }
}

export const advanceWorldTurn = (world: World, seedOffset = 0): string[] => {
  const rng = new SeededRng(world.seed + world.turn * 17 + seedOffset)
  world.turn += 1
  const nextSeason = determineSeasonFromTurn(world.turn)
  world.season = nextSeason.season
  world.seasonTurn = nextSeason.seasonTurn

  const messages: string[] = [`World turn ${world.turn}: ${world.season}.`]
  messages.push(...simulateEconomyTurn(world, rng))

  Object.values(world.characters).forEach((char) => {
    if (char.alive) char.ap = char.maxAp
  })

  for (let apStep = 0; apStep < 4; apStep += 1) {
    for (const actor of Object.values(world.characters)) {
      if (!actor.alive || actor.id === world.playerId) continue
      processNpcIntent(world, actor, rng, messages)
    }
    resolveTileCombats(world, rng, messages)
  }

  messages.push(...spawnWorldEvents(world, rng))
  healInCities(world)

  const player = world.characters[world.playerId]
  if (player?.alive) player.ap = player.maxAp
  world.pendingRobberyCharacterId = undefined
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const playerAttackOnTile = (world: World, targetId: string): string[] => {
  const player = world.characters[world.playerId]
  if (!player || !player.alive) return ['Player unavailable.']
  const target = world.characters[targetId]
  if (!target || !target.alive) return ['Target unavailable.']
  if (player.location !== target.location) return ['You need to stand on the same tile to attack.']
  if (player.ap < 2) return ['Not enough AP to attack.']
  player.ap -= 2
  const rng = new SeededRng(world.seed + world.turn * 13)
  const messages = performAttack(world, player.id, target.id, rng)
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const playerRob = (world: World, traderId: string, confirm = false): string[] => {
  const player = world.characters[world.playerId]
  const trader = world.characters[traderId]
  if (!player || !trader || !trader.alive) return ['Invalid robbery target.']
  if (player.location !== trader.location) return ['Move onto the caravan tile first.']
  if (trader.role !== 'trader') return ['That target is not a caravan.']
  if (player.ap < 2) return ['Not enough AP to rob.']
  if (player.reputation > 0 && !confirm) {
    world.pendingRobberyCharacterId = traderId
    return ['Robbing this caravan will hurt your reputation. Confirm?']
  }
  player.ap -= 2
  const stolenEntries = Object.entries(trader.inventory)
  if (stolenEntries.length === 0) return ['The caravan has nothing left.']
  for (const [good, qty] of stolenEntries) {
    if (!qty) continue
    player.inventory[good as keyof typeof player.inventory] =
      (player.inventory[good as keyof typeof player.inventory] ?? 0) + qty
  }
  trader.alive = false
  player.reputation -= 25
  world.pendingRobberyCharacterId = undefined
  const messages = [`You robbed ${trader.name}. City guards may retaliate.`]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

