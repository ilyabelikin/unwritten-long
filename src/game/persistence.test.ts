import { describe, expect, it } from 'vitest'
import { generateWorld } from '../core/worldgen/generateWorld'
import { deserializeWorld, serializeWorld } from './persistence'

describe('game persistence', () => {
  it('serializes and deserializes world snapshots', () => {
    const world = generateWorld(6400)
    const serialized = serializeWorld(world)
    const loaded = deserializeWorld(serialized)
    expect(loaded.world).toBeDefined()
    expect(loaded.timestamp).toBeTypeOf('number')
    expect(loaded.world?.seed).toBe(world.seed)
    expect(loaded.world?.turn).toBe(world.turn)
    expect(loaded.world?.playerId).toBe(world.playerId)
  })

  it('migrates settlements missing meta defaults', () => {
    const world = generateWorld(6401)
    const settlement = Object.values(world.settlements)[0]
    const kingdom = Object.values(world.kingdoms)[0]
    // simulate older save payload without meta
    // @ts-expect-error legacy payload intentionally omits field
    delete settlement.meta
    // @ts-expect-error legacy payload intentionally omits field
    delete world.kingdomRelations
    // @ts-expect-error legacy payload intentionally omits field
    delete world.kingdomConflicts
    // @ts-expect-error legacy payload intentionally omits field
    delete world.campaignProgress
    // @ts-expect-error legacy payload intentionally omits field
    delete world.playerKingdomFavor
    // @ts-expect-error legacy payload intentionally omits field
    delete world.playerCourtFavor
    // @ts-expect-error legacy payload intentionally omits field
    delete world.contracts
    // @ts-expect-error legacy payload intentionally omits field
    delete kingdom.policy
    const serialized = serializeWorld(world)
    const loaded = deserializeWorld(serialized)
    const loadedSettlement = loaded.world?.settlements[settlement.id]
    const loadedKingdom = loaded.world?.kingdoms[kingdom.id]
    expect(loadedSettlement?.meta.cropStage).toBe('dormant')
    expect(loadedSettlement?.meta.foodStress).toBe(0)
    expect(loadedSettlement?.meta.prosperity).toBe(40)
    expect(loadedSettlement?.meta.siegePressure).toBe(0)
    expect(Object.keys(loaded.world?.kingdomRelations ?? {})).not.toHaveLength(0)
    expect(Object.keys(loaded.world?.kingdomConflicts ?? {})).not.toHaveLength(0)
    expect(Object.keys(loaded.world?.campaignProgress ?? {})).not.toHaveLength(0)
    expect(Object.keys(loaded.world?.playerKingdomFavor ?? {})).not.toHaveLength(0)
    expect(loaded.world?.playerCourtFavor).toBeDefined()
    expect(Number(loaded.world?.playerCourtFavor.merchant_bloc ?? -1)).toBeGreaterThanOrEqual(0)
    expect(loaded.world?.contracts).toBeDefined()
    expect(loadedKingdom?.policy.tradeStance).toBe('balanced')
    expect(loadedKingdom?.policy.guardHostilityReputation).toBe(-18)
    expect(loadedKingdom?.policy.guardHostilityBounty).toBe(20)
    expect(loadedKingdom?.policy.bountyDecayPerTick).toBe(2)
    expect(loadedKingdom?.policy.pardonGoldFactor).toBe(1)
    expect(loadedKingdom?.policy.courtStability).toBe(55)
    expect(loadedKingdom?.policy.nobleInfluence).toBe(45)
    expect(loadedKingdom?.policy.courtFaction).toBe('merchant_bloc')
    expect(loadedKingdom?.policy.factionTension).toBe(35)
    expect(loadedKingdom?.policy.activeEdict).toBe('none')
    expect(loadedKingdom?.policy.edictExpiresTurn).toBe(-1)
  })
})

