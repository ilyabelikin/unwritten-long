import type { Settlement, World } from '../core/types'
import { kingdomPairKey } from '../core/sim/diplomacy'

export const SAVE_KEY = 'frontier-realms-save-v1'
const SAVE_VERSION = 1

interface SavedPayload {
  version: number
  timestamp: number
  world: World
}

const ensureSettlementMeta = (settlement: Settlement): void => {
  settlement.meta = settlement.meta ?? {
    cropStage: 'dormant',
    foodStress: 0,
    prosperity: 40,
  }
  settlement.meta.cropStage = settlement.meta.cropStage ?? 'dormant'
  settlement.meta.foodStress = Number.isFinite(settlement.meta.foodStress) ? settlement.meta.foodStress : 0
  settlement.meta.prosperity = Number.isFinite(settlement.meta.prosperity) ? settlement.meta.prosperity : 40
}

const ensureKingdomRelations = (world: World): void => {
  if (!world.kingdomRelations) world.kingdomRelations = {}
  const ids = Object.keys(world.kingdoms)
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = kingdomPairKey(ids[i], ids[j])
      if (!Number.isFinite(world.kingdomRelations[key])) {
        world.kingdomRelations[key] = 0
      }
    }
  }
}

export const serializeWorld = (world: World): string =>
  JSON.stringify({
    version: SAVE_VERSION,
    timestamp: Date.now(),
    world,
  } as SavedPayload)

export const deserializeWorld = (payload: string): { world?: World; timestamp?: number } => {
  try {
    const parsed = JSON.parse(payload) as Partial<SavedPayload>
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_VERSION || !parsed.world) {
      return {}
    }
    const world = parsed.world
    for (const settlement of Object.values(world.settlements)) {
      ensureSettlementMeta(settlement)
    }
    ensureKingdomRelations(world)
    world.messages = world.messages ?? []
    return {
      world,
      timestamp: parsed.timestamp ?? Date.now(),
    }
  } catch {
    return {}
  }
}

export const saveToLocalStorage = (world: World): number | undefined => {
  if (typeof window === 'undefined') return undefined
  const timestamp = Date.now()
  try {
    const payload = JSON.stringify({ version: SAVE_VERSION, timestamp, world } as SavedPayload)
    window.localStorage.setItem(SAVE_KEY, payload)
    return timestamp
  } catch {
    return undefined
  }
}

export const loadFromLocalStorage = (): { world?: World; timestamp?: number } => {
  if (typeof window === 'undefined') return {}
  const payload = window.localStorage.getItem(SAVE_KEY)
  if (!payload) return {}
  return deserializeWorld(payload)
}

