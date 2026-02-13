import { BASE_GOOD_PRICE, FOOD_GOODS } from '../constants'
import { BUILDING_COSTS, BUILDING_TEMPLATES } from '../data/content'
import { keyFor, neighborsOf, parseKey } from '../hex'
import { shortestPath } from '../pathing'
import { SeededRng } from '../random'
import type { BuildingType, Character, Good, Settlement, World } from '../types'
import { addGoods, clamp, consumeGoods, createGoodRecord } from '../utils'

const seasonProductionMultiplier = (
  buildingType: string,
  season: World['season'],
  good: Good,
): number => {
  if (buildingType === 'field' && good === 'grain') {
    if (season === 'spring') return 0.35
    if (season === 'summer') return 0.9
    if (season === 'autumn') return 1.8
    return 0.15
  }
  if (buildingType === 'fisher_home' && good === 'fish') {
    return season === 'winter' ? 0.65 : 1
  }
  if (buildingType === 'hunter_lodge' && good === 'meat') {
    return season === 'winter' ? 0.55 : 1
  }
  if (buildingType === 'village_home' && good === 'vegetables') {
    if (season === 'winter') return 0.2
    if (season === 'autumn') return 1.4
  }
  return 1
}

export const estimateGoodPrice = (settlement: Settlement, good: Good, season: World['season']): number => {
  const base = BASE_GOOD_PRICE[good]
  const stock = settlement.stockpile[good] ?? 0
  const need = settlement.needs[good] ?? 1
  const scarcityFactor = clamp(1 + (need - stock) / Math.max(need, 1), 0.6, 2.8)
  const urgencyFactor = clamp(1 + need / Math.max(stock + 1, 1) * 0.45, 0.85, 2.1)
  const seasonFactor =
    good === 'grain' || good === 'vegetables' || good === 'fish'
      ? season === 'winter'
        ? 1.25
        : season === 'autumn'
          ? 0.92
          : 1
      : 1
  return Math.round(base * scarcityFactor * urgencyFactor * seasonFactor * 10) / 10
}

const evaluateDream = (settlement: Settlement, world: World): string => {
  const centerTile = world.tiles[settlement.tiles[0]]
  const nearDeepForest = neighborsOf(centerTile.coord).some(
    (n) => world.tiles[keyFor(n.q, n.r)]?.vegetation === 'deep_forest',
  )
  const nearShore = neighborsOf(centerTile.coord).some(
    (n) => ['sea', 'coast'].includes(world.tiles[keyFor(n.q, n.r)]?.terrain ?? ''),
  )
  const has = (type: BuildingType): boolean => settlement.buildings.some((b) => b.type === type)

  const foodNeed = settlement.needs.vegetables + settlement.needs.fish + settlement.needs.grain
  const foodStock = settlement.stockpile.vegetables + settlement.stockpile.fish + settlement.stockpile.grain
  if (foodStock < foodNeed * 0.8) {
    if (nearShore && !has('fisher_home')) return 'Build fisher home for food security.'
    if (!has('field')) return 'Expand fields before winter.'
    return 'Build another village home to boost food.'
  }
  if (nearDeepForest && !has('hunter_lodge') && !has('lumber_camp')) {
    if ((settlement.stockpile.wood ?? 0) < (settlement.stockpile.meat ?? 0)) {
      return 'Build lumber camp to support industry.'
    }
    return 'Build hunter lodge to preserve food from game.'
  }
  if (!has('mine') && centerTile.resources.some((r) => r === 'stone' || r === 'iron_ore')) {
    return 'Open a mine for long-term growth.'
  }
  if (has('mine') && !has('smelter')) return 'Build smelter for metal processing.'
  if (has('smelter') && !has('smithy')) return 'Build smithy for tools.'
  if (settlement.tier !== 'city' && settlement.populationIds.length > 16) {
    return 'Expand toward town status with urban housing.'
  }
  return 'Accumulate reserves and train workers.'
}

const canConstruct = (settlement: Settlement, building: BuildingType): boolean => {
  if (settlement.buildings.some((b) => b.type === building)) {
    if (building === 'village_home' || building === 'fisher_home' || building === 'city_home') {
      return true
    }
    return false
  }
  const exclusions = BUILDING_TEMPLATES[building].excludes ?? []
  return !settlement.buildings.some((b) => exclusions.includes(b.type))
}

const buildByDreamText = (dream: string): BuildingType | undefined => {
  const map: [BuildingType, string][] = [
    ['fisher_home', 'fisher'],
    ['field', 'field'],
    ['village_home', 'village home'],
    ['hunter_lodge', 'hunter'],
    ['lumber_camp', 'lumber'],
    ['mine', 'mine'],
    ['smelter', 'smelter'],
    ['smithy', 'smithy'],
    ['city_home', 'urban housing'],
  ]
  return map.find((entry) => dream.toLowerCase().includes(entry[1]))?.[0]
}

const attemptConstruction = (settlement: Settlement, messages: string[]): void => {
  const target = buildByDreamText(settlement.dream)
  if (!target || !canConstruct(settlement, target)) return

  const cost = BUILDING_COSTS[target]
  if (!consumeGoods(settlement.stockpile, cost)) return
  if (settlement.treasury < 20) return
  settlement.treasury -= 20

  const existing = settlement.buildings.filter((b) => b.type === target).length
  settlement.buildings.push({
    id: `${target}-${settlement.id}-${existing + 1}`,
    type: target,
    level: 1,
    density:
      target === 'city_home'
        ? 3
        : target === 'village_home' || target === 'fisher_home'
          ? 1
          : 0,
    workforce: BUILDING_TEMPLATES[target].baseWorkforce,
  })
  messages.push(`${settlement.name} completed ${BUILDING_TEMPLATES[target].name}.`)
}

const chooseJobForCitizen = (citizen: Character, settlement: Settlement): string => {
  let bestScore = -999
  let best = 'idle'
  for (const building of settlement.buildings) {
    const template = BUILDING_TEMPLATES[building.type]
    if (!template.produces || building.workforce <= 0) continue
    let needScore = 0
    for (const good of Object.keys(template.produces) as Good[]) {
      const deficit = (settlement.needs[good] ?? 0) - (settlement.stockpile[good] ?? 0)
      needScore += deficit
    }
    const skillMatch =
      citizen.skills[
        building.type === 'field'
          ? 'farming'
          : building.type === 'fisher_home'
            ? 'fishing'
            : building.type === 'mine'
              ? 'mining'
              : building.type === 'smithy'
                ? 'smithing'
                : building.type === 'hunter_lodge'
                  ? 'hunting'
                  : 'farming'
      ] ?? 0
    const score = needScore + skillMatch * 2 + Math.random() * 0.5
    if (score > bestScore) {
      bestScore = score
      best = building.id
    }
  }
  return best
}

const consumeFood = (settlement: Settlement, population: number, messages: string[]): number => {
  let hungry = 0
  for (let i = 0; i < population; i += 1) {
    const consumed = FOOD_GOODS.some((good) => {
      if (settlement.stockpile[good] > 0) {
        settlement.stockpile[good] -= 1
        return true
      }
      return false
    })
    if (!consumed) hungry += 1
  }
  if (hungry > 0) {
    messages.push(`${settlement.name} has ${hungry} hungry residents this turn.`)
  }
  return hungry
}

const spawnCaravan = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  messages: string[],
): void => {
  const traders = Object.values(world.characters).filter(
    (c) =>
      c.role === 'trader' &&
      c.alive &&
      c.meta.homeSettlementId === settlement.id &&
      c.meta.state !== 'finished',
  )
  if (traders.length > 1) return
  if (settlement.treasury < 24) return

  let bestDeal:
    | {
        source: Settlement
        good: Good
        qty: number
        buyPrice: number
        sellPrice: number
      }
    | undefined

  for (const good of Object.keys(settlement.needs) as Good[]) {
    const deficit = settlement.needs[good] - settlement.stockpile[good]
    if (deficit <= 2) continue
    for (const other of Object.values(world.settlements)) {
      if (other.id === settlement.id) continue
      const surplus = other.stockpile[good] - other.needs[good]
      if (surplus <= 2) continue
      const buyPrice = estimateGoodPrice(other, good, world.season)
      const sellPrice = estimateGoodPrice(settlement, good, world.season)
      const qty = Math.min(10, Math.floor(surplus), Math.floor(deficit))
      if (qty < 2) continue
      const margin = (sellPrice - buyPrice) * qty
      if (margin <= 6) continue
      if (!bestDeal || margin > (bestDeal.sellPrice - bestDeal.buyPrice) * bestDeal.qty) {
        bestDeal = { source: other, good, qty, buyPrice, sellPrice }
      }
    }
  }

  if (!bestDeal) return
  const sourceCenter = bestDeal.source.tiles[0]
  const homeCenter = settlement.tiles[0]
  const homeCoord = parseKey(homeCenter)
  const sourceCoord = parseKey(sourceCenter)
  const distance = Math.abs(homeCoord.q - sourceCoord.q) + Math.abs(homeCoord.r - sourceCoord.r)
  if (distance > 28) return
  const travelPath = shortestPath(world, homeCenter, sourceCenter)
  if (travelPath.length < 2) return

  const buyCost = bestDeal.buyPrice * bestDeal.qty
  if (buyCost > settlement.treasury) return
  if (bestDeal.source.stockpile[bestDeal.good] < bestDeal.qty) return

  settlement.treasury -= buyCost
  bestDeal.source.stockpile[bestDeal.good] -= bestDeal.qty
  bestDeal.source.treasury += buyCost

  const id = `trader-${world.turn}-${rng.int(1000, 9999)}`
  const trader: Character = {
    id,
    name: `Trader ${rng.int(10, 99)}`,
    role: 'trader',
    species: 'human',
    hp: 8,
    maxHp: 8,
    ap: 4,
    maxAp: 4,
    age: rng.int(19, 50),
    skills: { travel: 4, barter: 5, combat: 2 },
    history: [`Commissioned by ${settlement.name} to trade ${bestDeal.good}.`],
    traits: ['pragmatic'],
    flaws: ['risk-averse'],
    reputation: 0,
    location: homeCenter,
    homeSettlementId: settlement.id,
    targetTileId: sourceCenter,
    alive: true,
    inventory: {
      [bestDeal.good]: bestDeal.qty,
    },
    meta: {
      homeSettlementId: settlement.id,
      sourceSettlementId: bestDeal.source.id,
      state: 'toHome',
      good: bestDeal.good,
      qty: bestDeal.qty,
      expectedSellPrice: bestDeal.sellPrice,
      travelPath,
      pathIndex: 0,
    },
  }
  world.characters[id] = trader
  messages.push(`${settlement.name} launched caravan for ${bestDeal.good}.`)
}

export const simulateEconomyTurn = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  for (const settlement of Object.values(world.settlements)) {
    const population = settlement.populationIds.filter((id) => world.characters[id]?.alive).length
    const needs = createGoodRecord(0)
    needs.vegetables = Math.ceil(population * 0.35)
    needs.fish = Math.ceil(population * 0.22)
    needs.grain = Math.ceil(population * 0.4)
    needs.meat = Math.ceil(population * 0.15)
    needs.wood = Math.ceil(population * 0.2)
    needs.stone = Math.ceil(population * 0.12)
    needs.clay = Math.ceil(population * 0.1)
    needs.iron_ore = Math.ceil(population * 0.09)
    needs.iron_ingot = Math.ceil(population * 0.06)
    needs.tools = Math.ceil(population * 0.05)
    needs.gold_ore = Math.ceil(population * 0.01)
    settlement.needs = needs

    const jobAssignments = new Map<string, string[]>()
    for (const building of settlement.buildings) {
      jobAssignments.set(building.id, [])
    }

    const workers = settlement.populationIds
      .map((id) => world.characters[id])
      .filter((c): c is Character => Boolean(c && c.alive && c.role !== 'guard' && c.role !== 'player'))

    for (const worker of workers) {
      const job = chooseJobForCitizen(worker, settlement)
      if (job === 'idle') continue
      const assigned = jobAssignments.get(job)
      const building = settlement.buildings.find((b) => b.id === job)
      if (!assigned || !building) continue
      if (assigned.length >= building.workforce) continue
      assigned.push(worker.id)
      worker.meta.job = building.type
      worker.skills[
        building.type === 'field'
          ? 'farming'
          : building.type === 'fisher_home'
            ? 'fishing'
            : building.type === 'mine'
              ? 'mining'
              : building.type === 'smithy'
                ? 'smithing'
                : building.type === 'hunter_lodge'
                  ? 'hunting'
                  : 'labor'
      ] = (worker.skills[
        building.type === 'field'
          ? 'farming'
          : building.type === 'fisher_home'
            ? 'fishing'
            : building.type === 'mine'
              ? 'mining'
              : building.type === 'smithy'
                ? 'smithing'
                : building.type === 'hunter_lodge'
                  ? 'hunting'
                  : 'labor'
      ] ?? 0) + 0.08
    }

    for (const building of settlement.buildings) {
      const template = BUILDING_TEMPLATES[building.type]
      if (!template.produces) continue
      const workerCount = jobAssignments.get(building.id)?.length ?? 0
      if (workerCount <= 0 && building.workforce > 0) continue
      const workerMultiplier = building.workforce <= 0 ? 1 : workerCount / building.workforce

      if (template.consumes && !consumeGoods(settlement.stockpile, template.consumes, workerMultiplier)) {
        continue
      }

      const production: Partial<Record<Good, number>> = {}
      for (const [good, amount] of Object.entries(template.produces) as [Good, number][]) {
        const seasonal = seasonProductionMultiplier(building.type, world.season, good)
        production[good] = amount * Math.max(0.2, workerMultiplier) * seasonal * Math.max(1, building.level)
      }
      addGoods(settlement.stockpile, production)
      const taxIncome = Object.values(production).reduce((acc, amount) => acc + amount * 0.4, 0)
      settlement.treasury += Math.round(taxIncome)
    }

    if (settlement.buildings.some((b) => b.type === 'lumber_camp')) {
      for (const tileId of settlement.tiles) {
        const tile = world.tiles[tileId]
        if (tile.vegetation === 'deep_forest' && rng.chance(0.12)) {
          tile.vegetation = 'sparse_trees'
          tile.resources = tile.resources.filter((res) => res !== 'wild_game')
        }
      }
    }

    const hungry = consumeFood(settlement, population, messages)
    if (hungry > 0) {
      for (const citizenId of settlement.populationIds.slice(0, hungry)) {
        const citizen = world.characters[citizenId]
        if (!citizen || !citizen.alive) continue
        citizen.hp -= 1
        citizen.history.push(`Suffered hunger in turn ${world.turn}.`)
      }
    }

    settlement.dream = evaluateDream(settlement, world)
    if (world.turn % 8 === 0) attemptConstruction(settlement, messages)
    spawnCaravan(world, settlement, rng, messages)
  }

  return messages
}

