import type { BuildingTemplate, BuildingType, Good, Species } from '../types'

export const SETTLEMENT_NAME_PARTS_A = [
  'Raven',
  'Stone',
  'River',
  'North',
  'South',
  'East',
  'West',
  'Green',
  'Gold',
  'Iron',
  'Oak',
  'Pine',
  'Deep',
  'Mist',
  'Sun',
]

export const SETTLEMENT_NAME_PARTS_B = [
  'ford',
  'haven',
  'watch',
  'ridge',
  'fall',
  'hollow',
  'stead',
  'field',
  'reach',
  'bay',
  'crown',
  'crest',
  'grove',
]

export const KINGDOM_NAMES = ['Aurelian March', 'Verdant League', 'Cinder Crown']

export const HUMAN_FIRST_NAMES = [
  'Alia',
  'Mira',
  'Tor',
  'Ivo',
  'Bryn',
  'Rhea',
  'Darin',
  'Sera',
  'Lukas',
  'Nia',
  'Jorin',
  'Kara',
  'Fen',
  'Hale',
  'Yara',
  'Milo',
  'Nox',
  'Rian',
]

export const TRAITS = [
  'brave',
  'careful',
  'charitable',
  'ambitious',
  'stubborn',
  'curious',
  'hardworking',
  'loyal',
]

export const FLAWS = [
  'greedy',
  'timid',
  'hot-headed',
  'superstitious',
  'lazy',
  'reckless',
  'naive',
]

export const SPECIES_LABEL: Record<Species, string> = {
  human: 'Human',
  rabbit: 'Rabbit',
  deer: 'Deer',
  wolf: 'Wolf',
  bear: 'Bear',
  boar: 'Boar',
  ogre: 'Ogre',
  wyrm: 'Wyrm',
}

export const BUILDING_TEMPLATES: Record<BuildingType, BuildingTemplate> = {
  village_home: {
    type: 'village_home',
    name: 'Village Home',
    baseWorkforce: 2,
    produces: { vegetables: 4 },
  },
  fisher_home: {
    type: 'fisher_home',
    name: 'Fisher Home',
    baseWorkforce: 2,
    produces: { fish: 4 },
    shoreOnly: true,
  },
  city_home: {
    type: 'city_home',
    name: 'City Home',
    baseWorkforce: 0,
    cityOnly: true,
  },
  field: {
    type: 'field',
    name: 'Field',
    baseWorkforce: 3,
    produces: { grain: 6 },
  },
  mine: {
    type: 'mine',
    name: 'Mine',
    baseWorkforce: 3,
    produces: { stone: 4, iron_ore: 3, gold_ore: 1 },
  },
  lumber_camp: {
    type: 'lumber_camp',
    name: 'Lumber Camp',
    baseWorkforce: 3,
    produces: { wood: 7 },
    excludes: ['hunter_lodge'],
  },
  hunter_lodge: {
    type: 'hunter_lodge',
    name: 'Hunter Lodge',
    baseWorkforce: 2,
    produces: { meat: 5 },
    excludes: ['lumber_camp'],
  },
  clay_pit: {
    type: 'clay_pit',
    name: 'Clay Pit',
    baseWorkforce: 2,
    produces: { clay: 6 },
  },
  smelter: {
    type: 'smelter',
    name: 'Smelter',
    baseWorkforce: 2,
    consumes: { iron_ore: 4, wood: 2 },
    produces: { iron_ingot: 3 },
  },
  smithy: {
    type: 'smithy',
    name: 'Smithy',
    baseWorkforce: 2,
    consumes: { iron_ingot: 3, wood: 1 },
    produces: { tools: 2 },
  },
}

export const BUILDING_COSTS: Record<BuildingType, Partial<Record<Good, number>>> = {
  village_home: { wood: 8, clay: 6 },
  fisher_home: { wood: 9, stone: 2 },
  city_home: { stone: 10, wood: 10, tools: 2 },
  field: { wood: 4, tools: 1 },
  mine: { wood: 8, tools: 2, stone: 3 },
  lumber_camp: { wood: 5, tools: 1 },
  hunter_lodge: { wood: 5, tools: 1 },
  clay_pit: { wood: 3, tools: 1 },
  smelter: { stone: 8, wood: 4, tools: 2 },
  smithy: { stone: 8, wood: 4, iron_ingot: 2 },
}
