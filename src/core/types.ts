export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export type Terrain = 'sea' | 'coast' | 'plains' | 'hills' | 'mountain'
export type Vegetation = 'none' | 'bush' | 'sparse_trees' | 'deep_forest'
export type Resource =
  | 'fish'
  | 'wild_game'
  | 'stone'
  | 'clay'
  | 'iron_ore'
  | 'gold_ore'

export type SettlementTier = 'hamlet' | 'village' | 'town' | 'city'
export type CropStage = 'dormant' | 'sown' | 'growing' | 'ripe'
export type BuildingType =
  | 'village_home'
  | 'fisher_home'
  | 'city_home'
  | 'field'
  | 'mine'
  | 'lumber_camp'
  | 'hunter_lodge'
  | 'clay_pit'
  | 'smelter'
  | 'smithy'

export type Good =
  | 'vegetables'
  | 'fish'
  | 'grain'
  | 'meat'
  | 'wood'
  | 'stone'
  | 'clay'
  | 'iron_ore'
  | 'iron_ingot'
  | 'tools'
  | 'gold_ore'

export type CharacterRole =
  | 'player'
  | 'villager'
  | 'trader'
  | 'bandit'
  | 'migrant'
  | 'guard'
  | 'monster'
  | 'wildlife'

export type Species =
  | 'human'
  | 'rabbit'
  | 'deer'
  | 'wolf'
  | 'bear'
  | 'boar'
  | 'ogre'
  | 'wyrm'

export interface HexCoord {
  q: number
  r: number
}

export interface Tile {
  id: string
  coord: HexCoord
  elevation: number
  terrain: Terrain
  vegetation: Vegetation
  resources: Resource[]
  road: boolean
  rough: boolean
  kingdomId?: string
  settlementId?: string
}

export interface BuildingInstance {
  id: string
  type: BuildingType
  level: number
  density: number
  workforce: number
}

export interface Character {
  id: string
  name: string
  role: CharacterRole
  species: Species
  hp: number
  maxHp: number
  ap: number
  maxAp: number
  age: number
  skills: Record<string, number>
  history: string[]
  traits: string[]
  flaws: string[]
  reputation: number
  location: string
  homeSettlementId?: string
  targetTileId?: string
  alive: boolean
  inventory: Partial<Record<Good, number>>
  meta: Record<string, unknown>
}

export interface Settlement {
  id: string
  name: string
  kingdomId: string
  tier: SettlementTier
  tiles: string[]
  populationIds: string[]
  buildings: BuildingInstance[]
  stockpile: Record<Good, number>
  treasury: number
  dream: string
  needs: Record<Good, number>
  meta: {
    cropStage: CropStage
    foodStress: number
    prosperity: number
  }
}

export interface Kingdom {
  id: string
  name: string
  color: string
  capitalSettlementId?: string
}

export interface World {
  seed: number
  width: number
  height: number
  tiles: Record<string, Tile>
  tileOrder: string[]
  settlements: Record<string, Settlement>
  characters: Record<string, Character>
  kingdoms: Record<string, Kingdom>
  playerId: string
  turn: number
  season: Season
  seasonTurn: number
  messages: string[]
  selectedTileId?: string
  selectedCharacterId?: string
  pendingRobberyCharacterId?: string
}

export interface BuildingTemplate {
  type: BuildingType
  name: string
  baseWorkforce: number
  produces?: Partial<Record<Good, number>>
  consumes?: Partial<Record<Good, number>>
  shoreOnly?: boolean
  cityOnly?: boolean
  excludes?: BuildingType[]
}

