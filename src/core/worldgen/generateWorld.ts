import { PLAYER_BASE_AP } from '../constants'
import { BUILDING_TEMPLATES, FLAWS, HUMAN_FIRST_NAMES, KINGDOM_NAMES, SETTLEMENT_NAME_PARTS_A, SETTLEMENT_NAME_PARTS_B, TRAITS } from '../data/content'
import { keyFor, neighborsOf } from '../hex'
import { shortestPath } from '../pathing'
import { SeededRng, hashNoise } from '../random'
import type { BuildingInstance, BuildingType, Character, Good, Kingdom, Resource, Season, Settlement, SettlementTier, Species, Tile, World } from '../types'
import { createGoodRecord } from '../utils'

const WORLD_WIDTH = 46
const WORLD_HEIGHT = 30

const tierPopulationRange: Record<SettlementTier, [number, number]> = {
  hamlet: [4, 8],
  village: [8, 14],
  town: [14, 22],
  city: [24, 36],
}

const tierFootprintSize: Record<SettlementTier, number> = {
  hamlet: 1,
  village: 2,
  town: 3,
  city: 5,
}

const tierPool: SettlementTier[] = [
  'hamlet',
  'hamlet',
  'village',
  'village',
  'village',
  'town',
  'town',
  'city',
]

const speciesStats: Record<
  Species,
  { hp: number; role: Character['role']; maxAp: number; aggressive: boolean }
> = {
  human: { hp: 10, role: 'villager', maxAp: PLAYER_BASE_AP, aggressive: false },
  rabbit: { hp: 4, role: 'wildlife', maxAp: 4, aggressive: false },
  deer: { hp: 6, role: 'wildlife', maxAp: 4, aggressive: false },
  boar: { hp: 8, role: 'wildlife', maxAp: 4, aggressive: true },
  wolf: { hp: 8, role: 'wildlife', maxAp: 4, aggressive: true },
  bear: { hp: 14, role: 'wildlife', maxAp: 4, aggressive: true },
  ogre: { hp: 18, role: 'monster', maxAp: 4, aggressive: true },
  wyrm: { hp: 20, role: 'monster', maxAp: 5, aggressive: true },
}

const scoreTileForSettlement = (tile: Tile, allTiles: Record<string, Tile>): number => {
  if (tile.terrain === 'sea' || tile.terrain === 'mountain') return -100
  let score = 0
  if (tile.terrain === 'coast') score += 8
  if (tile.terrain === 'plains') score += 9
  if (tile.terrain === 'hills') score += 7
  if (tile.resources.includes('iron_ore')) score += 8
  if (tile.resources.includes('stone')) score += 6
  if (tile.resources.includes('gold_ore')) score += 4
  if (tile.resources.includes('clay')) score += 4
  if (tile.vegetation === 'deep_forest') score += 5
  const neighborLand = neighborsOf(tile.coord).reduce((acc, n) => {
    const t = allTiles[keyFor(n.q, n.r)]
    if (!t) return acc
    return acc + (t.terrain === 'sea' ? -1 : 1)
  }, 0)
  score += neighborLand
  return score
}

const seededName = (rng: SeededRng): string =>
  `${rng.pick(SETTLEMENT_NAME_PARTS_A)}${rng.pick(SETTLEMENT_NAME_PARTS_B)}`

const buildId = (prefix: string, n: number): string => `${prefix}-${n.toString(36)}`

const makeBuilding = (type: BuildingType, level: number, density: number, index: number): BuildingInstance => ({
  id: buildId(type, index),
  type,
  level,
  density,
  workforce: Math.max(0, BUILDING_TEMPLATES[type].baseWorkforce * level),
})

const randomGoodNeeds = (population: number): Record<Good, number> => ({
  vegetables: Math.ceil(population * 0.3),
  fish: Math.ceil(population * 0.2),
  grain: Math.ceil(population * 0.4),
  meat: Math.ceil(population * 0.2),
  wood: Math.ceil(population * 0.25),
  stone: Math.ceil(population * 0.16),
  clay: Math.ceil(population * 0.14),
  iron_ore: Math.ceil(population * 0.12),
  iron_ingot: Math.ceil(population * 0.1),
  tools: Math.ceil(population * 0.08),
  gold_ore: Math.ceil(population * 0.02),
})

const housingCapacity = (building: BuildingInstance): number => {
  if (building.type === 'village_home' || building.type === 'fisher_home') {
    return Math.min(3, building.density) * 6
  }
  if (building.type === 'city_home') {
    return Math.min(9, Math.max(3, building.density)) * 6
  }
  return 0
}

const pickSettlementTier = (rng: SeededRng, score: number): SettlementTier => {
  if (score > 26 && rng.chance(0.4)) return 'city'
  if (score > 20 && rng.chance(0.5)) return 'town'
  if (score > 16 && rng.chance(0.7)) return 'village'
  return rng.pick(tierPool)
}

const chooseSettlementTiles = (
  centerTileId: string,
  targetSize: number,
  tiles: Record<string, Tile>,
): string[] => {
  const chosen: string[] = [centerTileId]
  const frontier: string[] = [centerTileId]
  const visited = new Set<string>([centerTileId])
  while (frontier.length > 0 && chosen.length < targetSize) {
    const current = frontier.shift()!
    const tile = tiles[current]
    for (const n of neighborsOf(tile.coord)) {
      const id = keyFor(n.q, n.r)
      if (visited.has(id)) continue
      visited.add(id)
      const neighborTile = tiles[id]
      if (!neighborTile || neighborTile.terrain === 'sea' || neighborTile.terrain === 'mountain') continue
      frontier.push(id)
      chosen.push(id)
      if (chosen.length >= targetSize) break
    }
  }
  return chosen
}

const settlementBuildingPlan = (
  settlement: Settlement,
  centerTile: Tile,
  tiles: Record<string, Tile>,
  rng: SeededRng,
): BuildingInstance[] => {
  const around = neighborsOf(centerTile.coord)
    .map((n) => tiles[keyFor(n.q, n.r)])
    .filter(Boolean)
  const nearDeepForest = around.some((tile) => tile.vegetation === 'deep_forest')
  const nearShore = centerTile.terrain === 'coast' || around.some((tile) => tile.terrain === 'coast')
  const nearOre = around.some((tile) => tile.resources.includes('iron_ore') || tile.resources.includes('gold_ore'))
  const nearClay = around.some((tile) => tile.resources.includes('clay'))

  let idx = 0
  const buildings: BuildingInstance[] = []
  const add = (type: BuildingType, level = 1, density = 1): void => {
    buildings.push(makeBuilding(type, level, density, ++idx))
  }

  if (nearShore) add('fisher_home', 1, rng.int(1, 3))
  add('village_home', 1, rng.int(1, 3))
  add('field')
  if (nearOre) add('mine')
  if (nearClay) add('clay_pit')
  if (nearDeepForest) {
    add(rng.chance(0.5) ? 'hunter_lodge' : 'lumber_camp')
  }

  if (settlement.tier === 'town' || settlement.tier === 'city') {
    add('smelter')
    add('smithy')
  }
  if (settlement.tier === 'city') {
    add('city_home', 1, rng.int(3, 7))
    add('city_home', 1, rng.int(3, 9))
  }
  return buildings
}

const initialStockpileForTier = (tier: SettlementTier): Record<Good, number> => {
  const base = createGoodRecord(0)
  const scale = tier === 'city' ? 2.5 : tier === 'town' ? 1.8 : tier === 'village' ? 1.2 : 1
  base.vegetables = Math.round(12 * scale)
  base.fish = Math.round(9 * scale)
  base.grain = Math.round(14 * scale)
  base.meat = Math.round(8 * scale)
  base.wood = Math.round(16 * scale)
  base.stone = Math.round(10 * scale)
  base.clay = Math.round(9 * scale)
  base.iron_ore = Math.round(7 * scale)
  base.iron_ingot = Math.round(4 * scale)
  base.tools = Math.round(3 * scale)
  base.gold_ore = Math.round(2 * scale)
  return base
}

const assignKingdoms = (
  settlements: Record<string, Settlement>,
  centerTiles: Record<string, string>,
  tiles: Record<string, Tile>,
  rng: SeededRng,
): Record<string, Kingdom> => {
  const kingdoms: Record<string, Kingdom> = {}
  const capitalSettlementIds: string[] = Object.keys(settlements)
    .sort((a, b) => settlements[b].populationIds.length - settlements[a].populationIds.length)
    .slice(0, 3)

  KINGDOM_NAMES.forEach((name, index) => {
    kingdoms[`kingdom-${index + 1}`] = {
      id: `kingdom-${index + 1}`,
      name,
      color: ['#d0b44c', '#5fa36a', '#9a6262'][index],
      capitalSettlementId: capitalSettlementIds[index],
    }
  })

  for (const settlement of Object.values(settlements)) {
    const center = tiles[centerTiles[settlement.id]]
    let closest = 'kingdom-1'
    let closestDistance = Number.POSITIVE_INFINITY
    for (const [id, kingdom] of Object.entries(kingdoms)) {
      const capId = kingdom.capitalSettlementId
      if (!capId) continue
      const capCenter = tiles[centerTiles[capId]]
      const d = Math.abs(center.coord.q - capCenter.coord.q) + Math.abs(center.coord.r - capCenter.coord.r)
      if (d < closestDistance) {
        closestDistance = d
        closest = id
      }
    }
    settlement.kingdomId = closest
    settlement.tiles.forEach((tileId) => {
      tiles[tileId].kingdomId = closest
    })
  }

  if (rng.chance(0.2)) {
    const randomSettlement = rng.pick(Object.values(settlements))
    randomSettlement.kingdomId = 'kingdom-2'
  }
  return kingdoms
}

const createHuman = (
  id: string,
  name: string,
  location: string,
  role: Character['role'],
  homeSettlementId: string | undefined,
  rng: SeededRng,
): Character => ({
  id,
  name,
  role,
  species: 'human',
  hp: 10,
  maxHp: 10,
  ap: PLAYER_BASE_AP,
  maxAp: PLAYER_BASE_AP,
  age: rng.int(16, 54),
  skills: {
    farming: rng.int(0, 4),
    fishing: rng.int(0, 4),
    mining: rng.int(0, 4),
    smithing: rng.int(0, 4),
    hunting: rng.int(0, 4),
    combat: rng.int(0, 5),
  },
  history: [
    `Born in ${homeSettlementId ? homeSettlementId : 'the wilds'}.`,
    'Survived early hunger years.',
  ],
  traits: [rng.pick(TRAITS), rng.pick(TRAITS)],
  flaws: [rng.pick(FLAWS)],
  reputation: rng.int(-5, 8),
  location,
  homeSettlementId,
  targetTileId: undefined,
  alive: true,
  inventory: {},
  meta: {},
})

const createCreature = (
  id: string,
  species: Species,
  location: string,
  rng: SeededRng,
): Character => {
  const stat = speciesStats[species]
  return {
    id,
    name: species === 'ogre' || species === 'wyrm' ? `${species} ${rng.int(10, 99)}` : species,
    role: stat.role,
    species,
    hp: stat.hp,
    maxHp: stat.hp,
    ap: stat.maxAp,
    maxAp: stat.maxAp,
    age: rng.int(1, 18),
    skills: { combat: rng.int(1, 6), roaming: rng.int(1, 4) },
    history: [`Roams near ${location}.`],
    traits: [stat.aggressive ? 'aggressive' : 'skittish'],
    flaws: [stat.aggressive ? 'impulsive' : 'fragile'],
    reputation: -20,
    location,
    alive: true,
    inventory: {},
    meta: { aggressive: stat.aggressive },
  }
}

const determineSeason = (turn: number): { season: Season; seasonTurn: number } => {
  const cycle = turn % (60 * 4)
  const seasonIndex = Math.floor(cycle / 60)
  const seasonTurn = cycle % 60
  const seasonOrder: Season[] = ['spring', 'summer', 'autumn', 'winter']
  return { season: seasonOrder[seasonIndex], seasonTurn }
}

export const generateWorld = (seed = Date.now() % 100000): World => {
  const rng = new SeededRng(seed)
  const tiles: Record<string, Tile> = {}
  const tileOrder: string[] = []

  const continentCenters = Array.from({ length: 4 }, () => ({
    q: rng.int(4, WORLD_WIDTH - 5),
    r: rng.int(3, WORLD_HEIGHT - 4),
    radius: rng.int(8, 16),
  }))

  for (let r = 0; r < WORLD_HEIGHT; r += 1) {
    for (let q = 0; q < WORLD_WIDTH; q += 1) {
      const id = keyFor(q, r)
      tileOrder.push(id)
      const edgePenalty =
        Math.min(q, WORLD_WIDTH - q - 1) * 0.03 + Math.min(r, WORLD_HEIGHT - r - 1) * 0.035

      const continentScore = continentCenters.reduce((best, center) => {
        const dist = Math.hypot(q - center.q, r - center.r)
        const candidate = 1 - dist / center.radius
        return Math.max(best, candidate)
      }, -1)

      const macroNoise = hashNoise(seed, q, r, 0.12) * 0.6 + hashNoise(seed + 333, q, r, 0.05) * 0.4
      const landScore = continentScore + macroNoise * 0.5 + edgePenalty - 0.28
      const isLand = landScore > 0.1

      const elevationRaw = isLand
        ? landScore * 4 + hashNoise(seed + 888, q, r, 0.2) * 1.4 + 1.2
        : 0
      const elevation = isLand ? Math.max(1, Math.min(5, Math.round(elevationRaw))) : 0
      const moisture = hashNoise(seed + 1010, q, r, 0.15)

      let terrain: Tile['terrain'] = 'sea'
      if (elevation >= 5) terrain = 'mountain'
      else if (elevation >= 3) terrain = 'hills'
      else if (elevation >= 2) terrain = 'plains'
      else if (elevation >= 1) terrain = 'coast'

      let vegetation: Tile['vegetation'] = 'none'
      if (terrain !== 'sea' && terrain !== 'mountain') {
        if (moisture > 0.72) vegetation = 'deep_forest'
        else if (moisture > 0.54) vegetation = 'sparse_trees'
        else if (moisture > 0.42) vegetation = 'bush'
      }

      const resources: Resource[] = []
      if (terrain === 'sea') resources.push('fish')
      if (terrain === 'hills' || terrain === 'mountain') {
        if (hashNoise(seed + 2020, q, r, 0.27) > 0.45) resources.push('stone')
        if (hashNoise(seed + 2021, q, r, 0.21) > 0.62) resources.push('iron_ore')
        if (terrain === 'mountain' && hashNoise(seed + 2022, q, r, 0.34) > 0.82) resources.push('gold_ore')
      }
      if (terrain === 'coast' || terrain === 'plains') {
        if (hashNoise(seed + 2222, q, r, 0.2) > 0.68) resources.push('clay')
      }
      if (vegetation === 'deep_forest') resources.push('wild_game')

      tiles[id] = {
        id,
        coord: { q, r },
        elevation,
        terrain,
        vegetation,
        resources,
        road: false,
        rough: terrain === 'hills' || terrain === 'mountain' || vegetation === 'deep_forest',
      }
    }
  }

  for (const tile of Object.values(tiles)) {
    if (tile.terrain === 'sea') continue
    const adjacentSea = neighborsOf(tile.coord).some((n) => tiles[keyFor(n.q, n.r)]?.terrain === 'sea')
    if (adjacentSea) {
      tile.terrain = 'coast'
      tile.elevation = 1
      tile.resources = tile.resources.filter((resource) => resource !== 'gold_ore')
    }
    if (tile.terrain === 'coast') {
      tile.resources = tile.resources.filter((resource) => resource !== 'gold_ore')
    }
  }

  const scoredTiles = Object.values(tiles)
    .map((tile) => ({ tile, score: scoreTileForSettlement(tile, tiles) }))
    .filter((entry) => entry.score > 6)
    .sort((a, b) => b.score - a.score)

  const settlements: Record<string, Settlement> = {}
  const settlementCenters: Record<string, string> = {}
  let settlementCounter = 1

  for (const entry of scoredTiles) {
    if (Object.keys(settlements).length >= 14) break
    const tile = entry.tile
    const tooClose = Object.values(settlementCenters).some((id) => {
      const other = tiles[id]
      const dist = Math.abs(other.coord.q - tile.coord.q) + Math.abs(other.coord.r - tile.coord.r)
      return dist < 7
    })
    if (tooClose) continue
    if (tile.settlementId) continue

    const settlementId = `settlement-${settlementCounter++}`
    const tier = pickSettlementTier(rng, entry.score)
    const footprint = chooseSettlementTiles(tile.id, tierFootprintSize[tier], tiles)
    footprint.forEach((tileId) => {
      tiles[tileId].settlementId = settlementId
    })

    settlements[settlementId] = {
      id: settlementId,
      name: seededName(rng),
      kingdomId: 'kingdom-1',
      tier,
      tiles: footprint,
      populationIds: [],
      buildings: [],
      stockpile: initialStockpileForTier(tier),
      treasury: rng.int(40, 120),
      dream: 'Grow and thrive.',
      needs: randomGoodNeeds(10),
    }
    settlementCenters[settlementId] = tile.id
  }

  for (const settlement of Object.values(settlements)) {
    const centerTile = tiles[settlementCenters[settlement.id]]
    settlement.buildings = settlementBuildingPlan(settlement, centerTile, tiles, rng)
    const popRange = tierPopulationRange[settlement.tier]
    const requestedPopulation = rng.int(popRange[0], popRange[1])
    const housing = settlement.buildings.reduce((acc, b) => acc + housingCapacity(b), 0)
    const population = Math.max(4, Math.min(requestedPopulation, Math.max(4, housing)))
    settlement.needs = randomGoodNeeds(population)
    settlement.treasury += population * 2
  }

  const kingdoms = assignKingdoms(settlements, settlementCenters, tiles, rng)

  const worldSkeleton: World = {
    seed,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tiles,
    tileOrder,
    settlements,
    kingdoms,
    characters: {},
    playerId: '',
    turn: 0,
    season: 'spring',
    seasonTurn: 0,
    messages: ['A new world rises from sea and stone.'],
  }

  const settlementIds = Object.keys(settlements)
  for (let i = 0; i < settlementIds.length; i += 1) {
    const source = settlementIds[i]
    const sourceCenter = settlementCenters[source]
    const neighborsByDistance = settlementIds
      .filter((id) => id !== source)
      .map((id) => {
        const a = tiles[sourceCenter].coord
        const b = tiles[settlementCenters[id]].coord
        return {
          id,
          distance: Math.abs(a.q - b.q) + Math.abs(a.r - b.r),
        }
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
    for (const target of neighborsByDistance) {
      const path = shortestPath(worldSkeleton, sourceCenter, settlementCenters[target.id])
      path.forEach((tileId) => {
        const tile = worldSkeleton.tiles[tileId]
        if (tile && tile.terrain !== 'sea') tile.road = true
      })
    }
  }

  const characters: Record<string, Character> = {}
  let characterCounter = 1

  const createCharacterId = (): string => `char-${characterCounter++}`

  const firstSettlement = settlements[settlementIds[0]]
  const playerTile = firstSettlement ? firstSettlement.tiles[0] : tileOrder.find((id) => tiles[id].terrain !== 'sea')!
  const player = createHuman(createCharacterId(), 'Player', playerTile, 'player', firstSettlement?.id, rng)
  player.species = 'human'
  player.reputation = 20
  player.history = ['Born into uncertain times.', `Set out from ${firstSettlement?.name ?? 'the coast'}.`]
  player.skills.combat = 4
  characters[player.id] = player
  worldSkeleton.playerId = player.id
  if (firstSettlement) firstSettlement.populationIds.push(player.id)

  for (const settlement of Object.values(settlements)) {
    const center = settlement.tiles[0]
    const targetPopulation = Math.max(4, settlement.needs.grain + settlement.needs.vegetables)
    while (settlement.populationIds.length < targetPopulation) {
      const id = createCharacterId()
      const villager = createHuman(id, rng.pick(HUMAN_FIRST_NAMES), center, 'villager', settlement.id, rng)
      villager.history = [
        `Born in ${settlement.name}.`,
        `Worked for ${rng.pick(['fields', 'fisher homes', 'the mine', 'the woods'])}.`,
      ]
      characters[id] = villager
      settlement.populationIds.push(id)
    }

    if (settlement.tier === 'city') {
      for (let g = 0; g < 2; g += 1) {
        const id = createCharacterId()
        const guard = createHuman(id, `${settlement.name} Guard`, center, 'guard', settlement.id, rng)
        guard.skills.combat = 6
        guard.traits = ['disciplined']
        guard.reputation = 0
        guard.meta.guardCityId = settlement.id
        characters[id] = guard
        settlement.populationIds.push(id)
      }
    }
  }

  const landTiles = tileOrder.filter((id) => tiles[id].terrain !== 'sea')
  const deepForestTiles = landTiles.filter((id) => tiles[id].vegetation === 'deep_forest')
  const mountainTiles = landTiles.filter((id) => tiles[id].terrain === 'mountain')
  const roadTiles = landTiles.filter((id) => tiles[id].road)

  for (const tileId of deepForestTiles) {
    if (rng.chance(0.045)) {
      const id = createCharacterId()
      characters[id] = createCreature(id, 'rabbit', tileId, rng)
    }
    if (rng.chance(0.03)) {
      const id = createCharacterId()
      characters[id] = createCreature(id, 'deer', tileId, rng)
    }
    if (rng.chance(0.015)) {
      const id = createCharacterId()
      characters[id] = createCreature(id, 'wolf', tileId, rng)
    }
    if (rng.chance(0.009)) {
      const id = createCharacterId()
      characters[id] = createCreature(id, 'bear', tileId, rng)
    }
  }
  for (const tileId of mountainTiles) {
    if (rng.chance(0.006)) {
      const id = createCharacterId()
      characters[id] = createCreature(id, rng.chance(0.75) ? 'ogre' : 'wyrm', tileId, rng)
    }
  }
  for (const tileId of roadTiles) {
    if (rng.chance(0.005)) {
      const bandit = createHuman(createCharacterId(), `Bandit ${rng.int(10, 99)}`, tileId, 'bandit', undefined, rng)
      bandit.reputation = -40
      bandit.skills.combat = 5
      bandit.meta.hostile = true
      characters[bandit.id] = bandit
    }
  }

  worldSkeleton.characters = characters
  const time = determineSeason(0)
  worldSkeleton.season = time.season
  worldSkeleton.seasonTurn = time.seasonTurn
  return worldSkeleton
}

