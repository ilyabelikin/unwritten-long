import type { Good, Season } from './types'

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
export const TURNS_PER_SEASON = 60
export const PLAYER_BASE_AP = 4

export const BASE_GOOD_PRICE: Record<Good, number> = {
  vegetables: 4,
  fish: 5,
  grain: 5,
  meat: 7,
  wood: 6,
  stone: 7,
  clay: 5,
  iron_ore: 9,
  iron_ingot: 14,
  tools: 20,
  gold_ore: 24,
}

export const ALL_GOODS = Object.keys(BASE_GOOD_PRICE) as Good[]

export const FOOD_GOODS: Good[] = ['vegetables', 'fish', 'grain', 'meat']
