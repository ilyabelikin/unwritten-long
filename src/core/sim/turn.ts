import { TURNS_PER_SEASON } from '../constants'
import { hexDistance, keyFor, neighborsOf, parseKey } from '../hex'
import { SeededRng } from '../random'
import type { Character, World } from '../types'
import { clamp } from '../utils'
import { performAttack, healInCities, isAggressiveTowards, cityGuardSpawnTiles } from './combat'
import { isAtWar, relationBetween, setRelation, setWarState, simulateDiplomacyTurn } from './diplomacy'
import { simulateEconomyTurn, estimateGoodPrice } from './economy'
import { spawnWorldEvents } from './events'
import { simulateWildlifeEcology } from './wildlife'

const seasonOrder: World['season'][] = ['spring', 'summer', 'autumn', 'winter']

const getPlayerBounty = (world: World): number =>
  Number(world.characters[world.playerId]?.meta.bounty ?? 0)

const addPlayerBounty = (world: World, amount: number): void => {
  const player = world.characters[world.playerId]
  if (!player) return
  player.meta.bounty = clamp(Number(player.meta.bounty ?? 0) + amount, 0, 9999)
}

const reducePlayerBounty = (world: World, amount: number): void => {
  const player = world.characters[world.playerId]
  if (!player) return
  player.meta.bounty = Math.max(0, Number(player.meta.bounty ?? 0) - amount)
}

const currentSettlementForPlayer = (world: World) => {
  const player = world.characters[world.playerId]
  if (!player?.alive) return undefined
  const tile = world.tiles[player.location]
  if (!tile?.settlementId) return undefined
  return world.settlements[tile.settlementId]
}

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

const nearestThreatForGuard = (world: World, guard: Character, guardKingdomId?: string): Character | undefined => {
  if (!guardKingdomId) return undefined
  const threats = Object.values(world.characters)
    .filter((candidate) => candidate.alive && candidate.id !== guard.id)
    .filter((candidate) => candidate.role === 'monster' || candidate.role === 'bandit')
    .filter((candidate) => {
      if (candidate.role === 'monster') return true
      const warPair = candidate.meta.warPair as string | undefined
      if (warPair) {
        const [left, right] = warPair.split('|')
        return left === guardKingdomId || right === guardKingdomId
      }
      return false
    })
    .map((candidate) => ({
      candidate,
      distance: hexDistance(parseKey(guard.location), parseKey(candidate.location)),
    }))
    .filter((entry) => entry.distance <= 6)
    .sort((a, b) => a.distance - b.distance)
  return threats[0]?.candidate
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
    const guardCityId = actor.meta.guardCityId as string | undefined
    const guardKingdomId = guardCityId ? world.settlements[guardCityId]?.kingdomId : actor.homeSettlementId
      ? world.settlements[actor.homeSettlementId]?.kingdomId
      : undefined
    const patrolFocus = guardKingdomId ? world.kingdoms[guardKingdomId]?.policy.patrolFocus ?? 0.4 : 0.4
    const criminalHeat = getPlayerBounty(world)
    if (player.reputation < -20 || criminalHeat >= 20) {
      const chaseRadius = patrolFocus >= 0.75 ? 6 : patrolFocus >= 0.5 ? 5 : 4
      const nearPlayer = hexDistance(parseKey(actor.location), parseKey(player.location)) <= chaseRadius
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

    const nearbyThreat = nearestThreatForGuard(world, actor, guardKingdomId)
    if (nearbyThreat) {
      const step = stepToward(world, actor, nearbyThreat.location)
      if (step && guardTiles.has(step)) {
        const cost = movementCost(world, actor.location, step)
        if (cost <= actor.ap) {
          actor.location = step
          actor.ap -= cost
        }
      }
      return
    }

    if (!rng.chance(Math.min(0.95, 0.35 + patrolFocus))) return
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
  messages.push(...simulateDiplomacyTurn(world, rng))

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
  messages.push(...simulateWildlifeEcology(world, rng))
  healInCities(world)
  const player = world.characters[world.playerId]
  if (player?.alive) {
    const bounty = Number(player.meta.bounty ?? 0)
    if (bounty > 0 && world.tiles[player.location].settlementId && world.seasonTurn % 5 === 0) {
      player.meta.bounty = Math.max(0, bounty - 2)
    }
  }

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
  if (target.role === 'trader' || target.role === 'villager' || target.role === 'guard') {
    addPlayerBounty(world, target.role === 'guard' ? 16 : 8)
    messages.push(`Your bounty rose to ${getPlayerBounty(world)}.`)
  }
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
  addPlayerBounty(world, 28)
  world.pendingRobberyCharacterId = undefined
  const messages = [`You robbed ${trader.name}. Bounty: ${getPlayerBounty(world)}. City guards may retaliate.`]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const playerDonateSupplies = (world: World): string[] => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player || !settlement) return ['You must stand in a settlement to donate supplies.']
  if (player.ap < 1) return ['Not enough AP to donate supplies.']

  const foodGoods: ('grain' | 'fish' | 'vegetables' | 'meat')[] = ['grain', 'fish', 'vegetables', 'meat']
  const donated: string[] = []
  let totalValue = 0
  for (const good of foodGoods) {
    const available = Math.floor(player.inventory[good] ?? 0)
    if (available <= 0) continue
    const amount = Math.min(available, 2)
    player.inventory[good] = available - amount
    settlement.stockpile[good] += amount
    donated.push(`${amount} ${good}`)
    totalValue += amount
  }

  if (totalValue <= 0) return ['You have no spare food supplies to donate.']

  player.ap -= 1
  player.reputation += Math.ceil(totalValue * 1.6)
  reducePlayerBounty(world, 6 + totalValue)
  settlement.meta.foodStress = clamp(settlement.meta.foodStress - totalValue * 2.8, 0, 100)
  settlement.meta.prosperity = clamp(settlement.meta.prosperity + totalValue * 1.5, 0, 100)
  const messages = [
    `You donated ${donated.join(', ')} to ${settlement.name}. Reputation and local morale improved.`,
  ]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const playerSponsorTreaty = (world: World): string[] => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player || !settlement) return ['You must be in a settlement to sponsor diplomacy.']
  if (player.ap < 2) return ['Not enough AP to sponsor a treaty.']

  const localKingdomId = settlement.kingdomId
  const foreignCandidates = Object.keys(world.kingdoms).filter((id) => id !== localKingdomId)
  if (foreignCandidates.length === 0) return ['No foreign kingdoms available for diplomacy.']

  const targetKingdomId = foreignCandidates
    .map((id) => ({ id, relation: relationBetween(world, localKingdomId, id) }))
    .sort((a, b) => a.relation - b.relation)[0].id

  const gold = Math.floor(player.inventory.gold_ore ?? 0)
  const tools = Math.floor(player.inventory.tools ?? 0)
  if (gold < 1 && tools < 2) {
    return ['You need at least 1 gold ore or 2 tools to sponsor diplomatic talks.']
  }

  if (gold >= 1) {
    player.inventory.gold_ore = gold - 1
  } else {
    player.inventory.tools = tools - 2
  }

  player.ap -= 2
  const current = relationBetween(world, localKingdomId, targetKingdomId)
  const improved = current + 14
  setRelation(world, localKingdomId, targetKingdomId, improved)
  if (isAtWar(world, localKingdomId, targetKingdomId) && improved >= -8) {
    setWarState(world, localKingdomId, targetKingdomId, false)
  }
  player.reputation += 3
  reducePlayerBounty(world, 4)
  const messages = [
    `You sponsored talks between ${world.kingdoms[localKingdomId].name} and ${world.kingdoms[targetKingdomId].name}.`,
  ]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

export const playerRequestPardon = (world: World): string[] => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player || !settlement) return ['You must be in a city to request pardon.']
  if (settlement.tier !== 'city') return ['Only a city authority can review your crimes.']
  if (player.ap < 1) return ['Not enough AP to request pardon.']
  const bounty = Number(player.meta.bounty ?? 0)
  if (bounty <= 0) return ['You are not currently wanted.']

  const gold = Math.floor(player.inventory.gold_ore ?? 0)
  const tools = Math.floor(player.inventory.tools ?? 0)
  const requiredGold = Math.max(1, Math.ceil(bounty / 35))
  if (gold < requiredGold && tools < requiredGold * 3) {
    return [`Pardon requires ${requiredGold} gold ore (or ${requiredGold * 3} tools).`]
  }

  if (gold >= requiredGold) {
    player.inventory.gold_ore = gold - requiredGold
  } else {
    player.inventory.tools = tools - requiredGold * 3
  }

  player.ap -= 1
  reducePlayerBounty(world, bounty)
  player.reputation += 4
  const messages = [
    `${settlement.name} authorities granted a pardon. Your bounty has been cleared.`,
  ]
  world.messages = [...messages, ...world.messages].slice(0, 120)
  return messages
}

