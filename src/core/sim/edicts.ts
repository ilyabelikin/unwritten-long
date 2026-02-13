import type { Kingdom } from '../types'
import { clamp } from '../utils'

type Policy = Kingdom['policy']

const edictReputationShift = (policy: Policy): number => {
  if (policy.activeEdict === 'martial_law') return 4
  if (policy.activeEdict === 'tax_relief') return -2
  return 0
}

const edictBountyShift = (policy: Policy): number => {
  if (policy.activeEdict === 'martial_law') return -5
  if (policy.activeEdict === 'tax_relief') return 3
  if (policy.activeEdict === 'trade_fair') return 2
  return 0
}

export const effectiveGuardHostilityReputation = (policy: Policy, manhuntActive: boolean): number =>
  clamp(
    Math.round(policy.guardHostilityReputation + edictReputationShift(policy) + (manhuntActive ? 8 : 0)),
    -40,
    12,
  )

export const effectiveGuardHostilityBounty = (policy: Policy, manhuntActive: boolean): number =>
  clamp(
    Math.round(policy.guardHostilityBounty + edictBountyShift(policy) - (manhuntActive ? 8 : 0)),
    6,
    60,
  )

export const effectiveBountyDecayPerTick = (policy: Policy): number => {
  if (policy.activeEdict === 'martial_law') return clamp(Math.round(policy.bountyDecayPerTick - 1), 1, 8)
  if (policy.activeEdict === 'tax_relief') return clamp(Math.round(policy.bountyDecayPerTick + 1), 1, 8)
  return clamp(Math.round(policy.bountyDecayPerTick), 1, 8)
}

export const effectivePardonGoldFactor = (policy: Policy): number => {
  if (policy.activeEdict === 'martial_law') return clamp(policy.pardonGoldFactor + 0.15, 0.5, 2.2)
  if (policy.activeEdict === 'tax_relief') return clamp(policy.pardonGoldFactor - 0.12, 0.5, 2.2)
  return clamp(policy.pardonGoldFactor, 0.5, 2.2)
}

export const effectiveTaxRate = (policy: Policy): number => {
  if (policy.activeEdict === 'tax_relief') return clamp(policy.taxRate - 0.035, 0.04, 0.32)
  if (policy.activeEdict === 'martial_law') return clamp(policy.taxRate + 0.02, 0.04, 0.32)
  if (policy.activeEdict === 'trade_fair') return clamp(policy.taxRate - 0.012, 0.04, 0.32)
  return clamp(policy.taxRate, 0.04, 0.32)
}

export const edictLabel = (edict: Policy['activeEdict']): string => {
  if (edict === 'martial_law') return 'Martial Law'
  if (edict === 'tax_relief') return 'Tax Relief'
  if (edict === 'trade_fair') return 'Trade Fair'
  return 'None'
}

