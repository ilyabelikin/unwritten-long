import { BASE_GOOD_PRICE, FOOD_GOODS, PLAYER_BASE_AP } from '../constants'
import { BUILDING_COSTS, BUILDING_TEMPLATES } from '../data/content'
import { keyFor, neighborsOf, parseKey } from '../hex'
import { safestPath, shortestPath } from '../pathing'
import { SeededRng } from '../random'
import { isAtWar, relationBetween } from './diplomacy'
import type { BuildingType, Character, CropStage, Good, Settlement, SettlementTier, World } from '../types'
import { addGoods, clamp, consumeGoods, createGoodRecord } from '../utils'

const seasonProductionMultiplier = (
  settlement: Settlement,
  world: World,
  buildingType: string,
  good: Good,
): number => {
  const season = world.season
  if (buildingType === 'field' && good === 'grain') {
    const stage = settlement.meta.cropStage
    if (stage === 'dormant') return season === 'winter' ? 0.04 : 0.12
    if (stage === 'sown') return season === 'spring' ? 0.3 : 0.16
    if (stage === 'growing') return season === 'summer' ? 0.9 : 0.42
    if (stage === 'ripe') {
      if (season === 'autumn') {
        const harvestWindow = world.seasonTurn < 18 ? 2 : world.seasonTurn < 36 ? 1.2 : 0.65
        return harvestWindow
      }
      return 0.25
    }
    return 0.25
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

const updateCropStage = (settlement: Settlement, world: World, messages: string[]): void => {
  if (world.seasonTurn !== 0) return
  const stage: CropStage = settlement.meta.cropStage
  const fieldCount = settlement.buildings.filter((building) => building.type === 'field').length
  if (fieldCount === 0) {
    settlement.meta.cropStage = 'dormant'
    return
  }

  if (world.season === 'spring') {
    const seedNeed = Math.max(1, fieldCount)
    if ((settlement.stockpile.grain ?? 0) >= seedNeed) {
      settlement.stockpile.grain -= seedNeed
      settlement.meta.cropStage = 'sown'
      messages.push(`${settlement.name} sowed spring grain fields.`)
    } else {
      settlement.meta.cropStage = 'dormant'
      messages.push(`${settlement.name} failed to sow all fields due to grain shortage.`)
    }
    return
  }

  if (world.season === 'summer') {
    settlement.meta.cropStage = stage === 'sown' || stage === 'growing' ? 'growing' : 'sown'
    return
  }

  if (world.season === 'autumn') {
    settlement.meta.cropStage = stage === 'growing' || stage === 'ripe' ? 'ripe' : 'growing'
    return
  }

  if (world.season === 'winter') {
    settlement.meta.cropStage = 'dormant'
  }
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

const settlementHasShoreAccess = (world: World, settlement: Settlement): boolean =>
  settlement.tiles.some((tileId) => {
    const tile = world.tiles[tileId]
    if (tile.terrain === 'coast') return true
    return neighborsOf(tile.coord).some((neighbor) => {
      const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
      return neighborTile?.terrain === 'sea' || neighborTile?.terrain === 'coast'
    })
  })

const canConstruct = (world: World, settlement: Settlement, building: BuildingType): boolean => {
  const template = BUILDING_TEMPLATES[building]
  if (template.shoreOnly && !settlementHasShoreAccess(world, settlement)) return false
  if (template.cityOnly && settlement.tier !== 'city') return false

  const existing = settlement.buildings.some((b) => b.type === building)
  if (existing && !['village_home', 'fisher_home', 'city_home'].includes(building)) {
    return false
  }

  const targetExclusions = template.excludes ?? []
  for (const built of settlement.buildings) {
    if (targetExclusions.includes(built.type)) return false
    const reverseExclusions = BUILDING_TEMPLATES[built.type].excludes ?? []
    if (reverseExclusions.includes(building)) return false
  }

  if (building === 'city_home' && settlement.tier !== 'city') return false
  if ((building === 'village_home' || building === 'fisher_home') && settlement.tier === 'city') return false
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

const attemptConstruction = (world: World, settlement: Settlement, messages: string[]): void => {
  const target = buildByDreamText(settlement.dream)
  if (!target || !canConstruct(world, settlement, target)) return

  const existingHousing = settlement.buildings.find((building) => building.type === target)
  if (existingHousing && ['village_home', 'fisher_home', 'city_home'].includes(target)) {
    const maxDensity = target === 'city_home' ? 9 : 3
    if (existingHousing.density < maxDensity) {
      const upgradeCost = BUILDING_COSTS[target]
      if (!consumeGoods(settlement.stockpile, upgradeCost, 0.5)) return
      if (settlement.treasury < 10) return
      settlement.treasury -= 10
      existingHousing.density += 1
      messages.push(`${settlement.name} increased ${BUILDING_TEMPLATES[target].name} density.`)
      return
    }
  }

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

const chooseJobForCitizen = (citizen: Character, settlement: Settlement, rng: SeededRng): string => {
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
    const score = needScore + skillMatch * 2 + rng.next() * 0.5
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

const sendHungryMigrant = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  messages: string[],
): void => {
  if (settlement.meta.foodStress < 34) return
  const originCenter = parseKey(settlement.tiles[0])
  const targets = Object.values(world.settlements)
    .filter(
      (candidate) =>
        candidate.id !== settlement.id && candidate.meta.prosperity > settlement.meta.prosperity + 8,
    )
    .sort((a, b) => {
      const aCenter = parseKey(a.tiles[0])
      const bCenter = parseKey(b.tiles[0])
      const aDist = Math.abs(aCenter.q - originCenter.q) + Math.abs(aCenter.r - originCenter.r)
      const bDist = Math.abs(bCenter.q - originCenter.q) + Math.abs(bCenter.r - originCenter.r)
      return aDist - bDist
    })
  const target = targets[0]
  if (!target) return

  const candidates = settlement.populationIds
    .map((id) => world.characters[id])
    .filter((character): character is Character => Boolean(character?.alive && character.role === 'villager'))
  if (candidates.length === 0) return
  const migrant = candidates[rng.int(0, candidates.length - 1)]
  migrant.role = 'migrant'
  migrant.history.push(`Left ${settlement.name} due to hunger pressures.`)
  migrant.meta = {
    targetSettlementId: target.id,
    pathProgress: 0,
    originSettlementId: settlement.id,
  }
  settlement.populationIds = settlement.populationIds.filter((id) => id !== migrant.id)
  messages.push(`${migrant.name} left ${settlement.name} as a migrant toward ${target.name}.`)
}

const buildDangerMap = (world: World): Record<string, number> => {
  const danger: Record<string, number> = {}
  for (const tileId of world.tileOrder) danger[tileId] = 0
  for (const actor of Object.values(world.characters)) {
    if (!actor.alive) continue
    const value =
      actor.role === 'bandit'
        ? 2.8
        : actor.role === 'monster'
          ? 3.8
          : actor.role === 'wildlife' && ['wolf', 'bear', 'boar'].includes(actor.species)
            ? 1.1
            : 0
    if (value <= 0) continue
    danger[actor.location] = (danger[actor.location] ?? 0) + value
  }
  return danger
}

const tierOrder: SettlementTier[] = ['hamlet', 'village', 'town', 'city']
const tierFootprintTarget: Record<SettlementTier, number> = {
  hamlet: 1,
  village: 2,
  town: 3,
  city: 5,
}

const tierPopulationThreshold: Record<SettlementTier, number> = {
  hamlet: 8,
  village: 14,
  town: 22,
  city: 30,
}

const housingCapacityForBuilding = (building: Settlement['buildings'][number]): number => {
  if (building.type === 'village_home' || building.type === 'fisher_home') {
    return clamp(building.density, 1, 3) * 6
  }
  if (building.type === 'city_home') {
    return clamp(building.density, 3, 9) * 6
  }
  return 0
}

const settlementHousingCapacity = (settlement: Settlement): number =>
  settlement.buildings.reduce((total, building) => total + housingCapacityForBuilding(building), 0)

const growHousingDensity = (settlement: Settlement, messages: string[]): void => {
  const homeBuildingTypes: BuildingType[] =
    settlement.tier === 'city' ? ['city_home'] : ['village_home', 'fisher_home']
  for (const type of homeBuildingTypes) {
    const building = settlement.buildings.find((candidate) => candidate.type === type)
    if (!building) continue
    const maxDensity = type === 'city_home' ? 9 : 3
    if (building.density < maxDensity) {
      building.density += 1
      messages.push(`${settlement.name} increased ${type.replace('_', ' ')} density to ${building.density}.`)
      return
    }
  }

  const newType: BuildingType =
    settlement.tier === 'city'
      ? 'city_home'
      : settlement.buildings.some((building) => building.type === 'fisher_home')
        ? 'village_home'
        : 'village_home'
  const nextIndex = settlement.buildings.filter((building) => building.type === newType).length + 1
  settlement.buildings.push({
    id: `${newType}-${settlement.id}-growth-${nextIndex}`,
    type: newType,
    level: 1,
    density: newType === 'city_home' ? 3 : 1,
    workforce: BUILDING_TEMPLATES[newType].baseWorkforce,
  })
  messages.push(`${settlement.name} built additional ${newType.replace('_', ' ')} housing.`)
}

const expandSettlementFootprint = (
  world: World,
  settlement: Settlement,
  targetSize: number,
  messages: string[],
): void => {
  if (settlement.tiles.length >= targetSize) return

  const frontier = new Set<string>()
  for (const tileId of settlement.tiles) {
    const tile = world.tiles[tileId]
    for (const neighbor of neighborsOf(tile.coord)) {
      const neighborId = keyFor(neighbor.q, neighbor.r)
      if (settlement.tiles.includes(neighborId)) continue
      const candidate = world.tiles[neighborId]
      if (!candidate || candidate.terrain === 'sea') continue
      if (candidate.settlementId && candidate.settlementId !== settlement.id) continue
      frontier.add(neighborId)
    }
  }

  const scored = Array.from(frontier).sort((a, b) => {
    const tileA = world.tiles[a]
    const tileB = world.tiles[b]
    const score = (tile: World['tiles'][string]): number => {
      let value = 0
      if (tile.terrain === 'plains' || tile.terrain === 'coast') value += 5
      if (tile.terrain === 'hills') value += 3
      if (tile.vegetation === 'deep_forest') value += 2
      if (tile.resources.includes('stone') || tile.resources.includes('iron_ore')) value += 2
      if (tile.road) value += 3
      return value
    }
    return score(tileB) - score(tileA)
  })

  while (settlement.tiles.length < targetSize && scored.length > 0) {
    const chosen = scored.shift()!
    settlement.tiles.push(chosen)
    world.tiles[chosen].settlementId = settlement.id
    world.tiles[chosen].kingdomId = settlement.kingdomId
  }
  if (settlement.tiles.length >= targetSize) {
    messages.push(`${settlement.name} expanded across nearby hexes.`)
  }
}

const nextTier = (tier: SettlementTier): SettlementTier | undefined => {
  const index = tierOrder.indexOf(tier)
  return tierOrder[index + 1]
}

const previousTier = (tier: SettlementTier): SettlementTier | undefined => {
  const index = tierOrder.indexOf(tier)
  return tierOrder[index - 1]
}

const spawnCityGuardIfNeeded = (
  world: World,
  settlement: Settlement,
  rng: SeededRng,
  messages: string[],
): void => {
  const activeGuards = settlement.populationIds.filter((id) => world.characters[id]?.role === 'guard')
  if (activeGuards.length >= 2) return
  const missing = 2 - activeGuards.length
  for (let i = 0; i < missing; i += 1) {
    const id = `guard-${settlement.id}-${world.turn}-${rng.int(100, 999)}-${i}`
    world.characters[id] = {
      id,
      name: `${settlement.name} Guard`,
      role: 'guard',
      species: 'human',
      hp: 11,
      maxHp: 11,
      ap: PLAYER_BASE_AP,
      maxAp: PLAYER_BASE_AP,
      age: rng.int(20, 44),
      skills: { combat: 6, patrol: 5 },
      history: [`Joined ${settlement.name} city guard.`],
      traits: ['disciplined'],
      flaws: ['strict'],
      reputation: 0,
      location: settlement.tiles[0],
      homeSettlementId: settlement.id,
      alive: true,
      inventory: {},
      meta: { guardCityId: settlement.id },
    }
    settlement.populationIds.push(id)
  }
  messages.push(`${settlement.name} raised additional city guards.`)
}

const manageSettlementGrowth = (
  world: World,
  settlement: Settlement,
  population: number,
  rng: SeededRng,
  messages: string[],
): void => {
  const housing = settlementHousingCapacity(settlement)
  if (population >= housing * 0.9 && settlement.treasury >= 24) {
    growHousingDensity(settlement, messages)
    settlement.treasury = Math.max(0, settlement.treasury - 16)
  }

  const candidateTier = nextTier(settlement.tier)
  if (candidateTier) {
    const hasTierPopulation = population >= tierPopulationThreshold[candidateTier]
    const prosperousEnough = settlement.meta.prosperity >= (candidateTier === 'city' ? 70 : 52)
    if (hasTierPopulation && prosperousEnough && settlement.treasury >= (candidateTier === 'city' ? 180 : 95)) {
      settlement.tier = candidateTier
      expandSettlementFootprint(world, settlement, tierFootprintTarget[candidateTier], messages)
      settlement.treasury = Math.max(0, settlement.treasury - (candidateTier === 'city' ? 70 : 35))
      settlement.dream = `Consolidate as a ${candidateTier}.`
      messages.push(`${settlement.name} grew into a ${candidateTier}.`)
      if (candidateTier === 'city') {
        spawnCityGuardIfNeeded(world, settlement, rng, messages)
      }
    }
  }

  const candidateDecline = previousTier(settlement.tier)
  if (
    candidateDecline &&
    settlement.meta.foodStress > 78 &&
    settlement.meta.prosperity < 18 &&
    population < tierPopulationThreshold[settlement.tier] * 0.6
  ) {
    settlement.tier = candidateDecline
    settlement.dream = `Recover from hard years and stabilize as a ${candidateDecline}.`
    messages.push(`${settlement.name} declined to ${candidateDecline} after severe hardship.`)
  }
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

  const homeKingdom = world.kingdoms[settlement.kingdomId]
  const homeTradeStance = homeKingdom?.policy.tradeStance ?? 'balanced'

  let bestDeal:
    | {
        source: Settlement
        good: Good
        qty: number
        buyPrice: number
        sellPrice: number
        tariff: number
        path: string[]
      }
    | undefined

  const dangerByTile = buildDangerMap(world)

  for (const good of Object.keys(settlement.needs) as Good[]) {
    const deficit = settlement.needs[good] - settlement.stockpile[good]
    if (deficit <= 2) continue
    for (const other of Object.values(world.settlements)) {
      if (other.id === settlement.id) continue
      const relation = relationBetween(world, settlement.kingdomId, other.kingdomId)
      if (isAtWar(world, settlement.kingdomId, other.kingdomId)) continue
      if (relation <= -45) continue
      const surplus = other.stockpile[good] - other.needs[good]
      if (surplus <= 2) continue
      const buyPrice = estimateGoodPrice(other, good, world.season)
      const sellPrice = estimateGoodPrice(settlement, good, world.season)
      const qty = Math.min(10, Math.floor(surplus), Math.floor(deficit))
      if (qty < 2) continue
      const sourceTradeStance = world.kingdoms[other.kingdomId]?.policy.tradeStance ?? 'balanced'
      const policyTariffOffset =
        (homeTradeStance === 'protectionist' ? 0.06 : homeTradeStance === 'open' ? -0.03 : 0) +
        (sourceTradeStance === 'protectionist' ? 0.05 : sourceTradeStance === 'open' ? -0.02 : 0)
      const tariffBase =
        settlement.kingdomId === other.kingdomId ? 0 : relation < 0 ? 0.2 : relation < 25 ? 0.11 : 0.04
      const tariff = clamp(tariffBase + policyTariffOffset, 0, 0.35)
      const sourceCenter = other.tiles[0]
      const homeCenter = settlement.tiles[0]
      const tradePath = safestPath(world, sourceCenter, homeCenter, dangerByTile)
      if (tradePath.length < 2) continue
      const routeDanger = tradePath.reduce((total, tileId) => total + (dangerByTile[tileId] ?? 0), 0)
      const riskCost = routeDanger * 0.9
      const margin = (sellPrice - buyPrice * (1 + tariff)) * qty - riskCost
      if (margin <= 6) continue
      if (!bestDeal || margin > (bestDeal.sellPrice - bestDeal.buyPrice * (1 + bestDeal.tariff)) * bestDeal.qty) {
        bestDeal = { source: other, good, qty, buyPrice, sellPrice, tariff, path: tradePath }
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
  const travelPath = bestDeal.path.length > 1 ? bestDeal.path : shortestPath(world, sourceCenter, homeCenter)
  if (travelPath.length < 2) return

  const buyCost = bestDeal.buyPrice * bestDeal.qty * (1 + bestDeal.tariff)
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
    location: sourceCenter,
    homeSettlementId: settlement.id,
    targetTileId: homeCenter,
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
  const tariffPercent = Math.round(bestDeal.tariff * 100)
  messages.push(
    `${settlement.name} launched caravan from ${bestDeal.source.name} with ${bestDeal.good}${tariffPercent > 0 ? ` (tariff ${tariffPercent}%)` : ''}.`,
  )
}

export const simulateEconomyTurn = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  for (const settlement of Object.values(world.settlements)) {
    const population = settlement.populationIds.filter((id) => world.characters[id]?.alive).length
    const seasonalNeedMultiplier =
      world.season === 'winter' ? 1.2 : world.season === 'summer' ? 0.94 : world.season === 'autumn' ? 1.05 : 1
    const needs = createGoodRecord(0)
    needs.vegetables = Math.ceil(population * 0.35 * seasonalNeedMultiplier)
    needs.fish = Math.ceil(population * 0.22 * (world.season === 'winter' ? 1.1 : 1))
    needs.grain = Math.ceil(population * 0.4 * seasonalNeedMultiplier)
    needs.meat = Math.ceil(population * 0.15 * (world.season === 'winter' ? 1.22 : 1))
    needs.wood = Math.ceil(population * 0.2 * (world.season === 'winter' ? 1.2 : 1))
    needs.stone = Math.ceil(population * 0.12)
    needs.clay = Math.ceil(population * 0.1)
    needs.iron_ore = Math.ceil(population * 0.09)
    needs.iron_ingot = Math.ceil(population * 0.06)
    needs.tools = Math.ceil(population * 0.05 * (world.season === 'winter' ? 1.06 : 1))
    needs.gold_ore = Math.ceil(population * 0.01)
    settlement.needs = needs
    updateCropStage(settlement, world, messages)

    const jobAssignments = new Map<string, string[]>()
    for (const building of settlement.buildings) {
      jobAssignments.set(building.id, [])
    }

    const workers = settlement.populationIds
      .map((id) => world.characters[id])
      .filter((c): c is Character => Boolean(c && c.alive && c.role !== 'guard' && c.role !== 'player'))

    for (const worker of workers) {
      const job = chooseJobForCitizen(worker, settlement, rng)
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
        const seasonal = seasonProductionMultiplier(settlement, world, building.type, good)
        production[good] = amount * Math.max(0.2, workerMultiplier) * seasonal * Math.max(1, building.level)
      }
      addGoods(settlement.stockpile, production)
      const taxIncome = Object.values(production).reduce((acc, amount) => acc + amount * 0.4, 0)
      const taxRate = world.kingdoms[settlement.kingdomId]?.policy.taxRate ?? 0.12
      settlement.treasury += Math.round(taxIncome * (0.65 + taxRate))
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
        if (citizen.hp <= 0) {
          citizen.alive = false
          citizen.history.push('Died from prolonged hunger.')
        }
      }
    }
    const hungryRatio = population > 0 ? hungry / population : 0
    settlement.meta.foodStress = clamp(
      settlement.meta.foodStress * 0.82 + hungryRatio * 100 * 0.6,
      0,
      100,
    )
    if (hungry === 0) {
      settlement.meta.foodStress = clamp(settlement.meta.foodStress - 1.2, 0, 100)
    }
    const reserves = settlement.stockpile.grain + settlement.stockpile.vegetables + settlement.stockpile.fish
    const economicHealth = (settlement.treasury + reserves * 2) / Math.max(1, population * 8)
    settlement.meta.prosperity = clamp(
      settlement.meta.prosperity * 0.85 + economicHealth * 22 - settlement.meta.foodStress * 0.06,
      0,
      100,
    )
    if (hungryRatio > 0.22 && world.turn % 6 === 0) {
      sendHungryMigrant(world, settlement, rng, messages)
    }
    manageSettlementGrowth(world, settlement, population, rng, messages)

    settlement.dream = evaluateDream(settlement, world)
    if (world.turn % 8 === 0) attemptConstruction(world, settlement, messages)
    spawnCaravan(world, settlement, rng, messages)

    for (const good of Object.keys(settlement.stockpile) as Good[]) {
      settlement.stockpile[good] = Math.max(0, Math.round(settlement.stockpile[good] * 100) / 100)
    }
    settlement.treasury = Math.max(0, Math.round(settlement.treasury * 100) / 100)
  }

  return messages
}

