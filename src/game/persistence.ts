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
  settlement.meta.siegePressure = Number.isFinite(settlement.meta.siegePressure) ? settlement.meta.siegePressure : 0
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

const ensureKingdomPoliciesAndConflicts = (world: World): void => {
  if (!world.kingdomConflicts) world.kingdomConflicts = {}
  const ids = Object.keys(world.kingdoms)
  for (const kingdom of Object.values(world.kingdoms)) {
    if (!kingdom.policy) {
      kingdom.policy = {
        taxRate: 0.12,
        patrolFocus: 0.45,
        tradeStance: 'balanced',
      }
    }
    kingdom.policy.taxRate = Number.isFinite(kingdom.policy.taxRate) ? kingdom.policy.taxRate : 0.12
    kingdom.policy.patrolFocus = Number.isFinite(kingdom.policy.patrolFocus)
      ? kingdom.policy.patrolFocus
      : 0.45
    kingdom.policy.tradeStance = kingdom.policy.tradeStance ?? 'balanced'
  }
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = kingdomPairKey(ids[i], ids[j])
      if (typeof world.kingdomConflicts[key] !== 'boolean') {
        world.kingdomConflicts[key] = false
      }
    }
  }
}

const ensureContracts = (world: World): void => {
  if (!world.contracts) world.contracts = {}
  for (const contract of Object.values(world.contracts)) {
    contract.meta = contract.meta ?? {}
    contract.level = Number.isFinite(contract.level) ? contract.level : 1
    contract.progress = Number.isFinite(contract.progress) ? contract.progress : 0
    contract.requiredAmount = Number.isFinite(contract.requiredAmount) ? contract.requiredAmount : 1
    contract.rewardReputation = Number.isFinite(contract.rewardReputation) ? contract.rewardReputation : 2
    contract.rewardBountyReduction = Number.isFinite(contract.rewardBountyReduction)
      ? contract.rewardBountyReduction
      : 0
    contract.rewardGoods = contract.rewardGoods ?? {}
    contract.expiresTurn = Number.isFinite(contract.expiresTurn) ? contract.expiresTurn : world.turn + 20
    contract.status = contract.status ?? 'available'
  }
}

const ensureCampaignProgress = (world: World): void => {
  if (!world.campaignProgress) world.campaignProgress = {}
  for (const kingdomId of Object.keys(world.kingdoms)) {
    if (!Number.isFinite(world.campaignProgress[kingdomId])) {
      world.campaignProgress[kingdomId] = 0
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
    ensureKingdomPoliciesAndConflicts(world)
    ensureCampaignProgress(world)
    ensureContracts(world)
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

