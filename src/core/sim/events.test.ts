import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { setRelation, setWarState } from './diplomacy'
import {
  simulateCourtPolitics,
  tryCorruptionCrackdown,
  tryDeclareManhunt,
  tryIssueAmnestyDecree,
  trySpawnWarRefugee,
} from './events'

describe('world events under conflict', () => {
  it('can spawn refugees when kingdoms are at war', () => {
    const world = generateWorld(9310)
    const kingdomIds = Object.keys(world.kingdoms)
    const left = kingdomIds[0]
    const right = kingdomIds[1]
    setRelation(world, left, right, -80)
    setWarState(world, left, right, true)
    world.turn = 14
    const message = trySpawnWarRefugee(world, new SeededRng(5), [left, right].sort().join('|'))
    const refugeeSpawned = Object.values(world.characters).some(
      (character) => character.role === 'migrant' && Boolean(character.meta.refugeeFromConflict),
    )
    expect(message).toContain('War refugees fled')
    expect(refugeeSpawned).toBe(true)
  })

  it('peace dividends stabilize migration and can suppress war refugees', () => {
    const world = generateWorld(9320)
    const kingdomIds = Object.keys(world.kingdoms)
    const left = kingdomIds[0]
    const right = kingdomIds[1]
    setRelation(world, left, right, -70)
    setWarState(world, left, right, true)
    world.turn = 21
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendIntensity = 26
    world.kingdoms[right].policy.peaceDividendIntensity = 26

    const message = trySpawnWarRefugee(world, new SeededRng(7), [left, right].sort().join('|'))
    expect(message).toBeUndefined()
    const refugeeSpawned = Object.values(world.characters).some(
      (character) => character.role === 'migrant' && character.meta.refugeeFromConflict === [left, right].sort().join('|'),
    )
    expect(refugeeSpawned).toBe(false)
  })

  it('can declare local manhunts against high-bounty players', () => {
    const world = generateWorld(9311)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = world.settlements[settlementId].kingdomId
    const threshold = world.kingdoms[kingdomId].policy.guardHostilityBounty
    player.meta.bounty = threshold + 12

    const message = tryDeclareManhunt(world, new SeededRng(2), kingdomId)
    const marshal = Object.values(world.characters).find(
      (character) => character.role === 'guard' && character.meta.justiceManhunt === true,
    )
    expect(message).toContain('declared a manhunt')
    expect(marshal).toBeDefined()
    expect(player.meta.manhuntKingdomId).toBe(kingdomId)
  })

  it('can issue amnesty decrees in peaceful open-trade kingdoms', () => {
    const world = generateWorld(9312)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = world.settlements[settlementId].kingdomId
    world.kingdoms[kingdomId].policy.tradeStance = 'open'
    world.kingdoms[kingdomId].policy.pardonGoldFactor = 0.9
    world.kingdoms[kingdomId].policy.bountyDecayPerTick = 4
    for (const key of Object.keys(world.kingdomConflicts)) {
      world.kingdomConflicts[key] = false
    }
    player.meta.bounty = 26
    const before = Number(player.meta.bounty ?? 0)

    const message = tryIssueAmnestyDecree(world, kingdomId)
    expect(message).toContain('amnesty decree')
    expect(Number(player.meta.bounty ?? 0)).toBeLessThan(before)
  })

  it('corruption crackdowns tighten legal thresholds and raise scrutiny', () => {
    const world = generateWorld(9313)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = world.settlements[settlementId].kingdomId
    const policy = world.kingdoms[kingdomId].policy
    policy.tradeStance = 'protectionist'
    policy.guardHostilityBounty = 20
    policy.pardonGoldFactor = 1.2
    player.meta.bounty = 15

    const message = tryCorruptionCrackdown(world, kingdomId)
    expect(message).toContain('anti-corruption crackdowns')
    expect(policy.guardHostilityBounty).toBeLessThan(20)
    expect(Number(player.meta.bounty ?? 0)).toBeGreaterThan(15)
  })

  it('court coups can trigger martial law edicts under instability', () => {
    const world = generateWorld(9314)
    const kingdomId = Object.keys(world.kingdoms)[0]
    const policy = world.kingdoms[kingdomId].policy
    policy.courtStability = 12
    policy.nobleInfluence = 84
    world.turn = 9

    const messages = simulateCourtPolitics(world, new SeededRng(1))
    expect(messages.some((line) => line.includes('court coup'))).toBe(true)
    expect(policy.activeEdict).toBe('martial_law')
    expect(policy.edictExpiresTurn).toBeGreaterThan(world.turn)
  })

  it('expired court edicts clear automatically', () => {
    const world = generateWorld(9315)
    const kingdomId = Object.keys(world.kingdoms)[0]
    const policy = world.kingdoms[kingdomId].policy
    policy.activeEdict = 'trade_fair'
    policy.edictExpiresTurn = 5
    world.turn = 6
    const messages = simulateCourtPolitics(world, new SeededRng(2))
    expect(policy.activeEdict).toBe('none')
    expect(policy.edictExpiresTurn).toBe(-1)
    expect(messages.some((line) => line.includes('edict expired'))).toBe(true)
  })

  it('court faction can flip toward war hawks under sustained war pressure', () => {
    const world = generateWorld(9316)
    const kingdomId = Object.keys(world.kingdoms)[0]
    const policy = world.kingdoms[kingdomId].policy
    policy.courtFaction = 'merchant_bloc'
    policy.factionTension = 70
    policy.courtStability = 28
    policy.tradeStance = 'protectionist'
    policy.guardHostilityBounty = 14
    for (const settlement of Object.values(world.settlements)) {
      if (settlement.kingdomId === kingdomId) {
        settlement.meta.prosperity = 16
      }
    }
    const rivals = Object.keys(world.kingdoms).filter((id) => id !== kingdomId)
    expect(rivals.length).toBeGreaterThan(0)
    if (rivals.length === 0) return
    for (const rival of rivals.slice(0, 2)) {
      setWarState(world, kingdomId, rival, true)
      setRelation(world, kingdomId, rival, -80)
    }
    world.turn = 9

    const messages = simulateCourtPolitics(world, new SeededRng(6))
    expect(policy.courtFaction).toBe('war_hawks')
    expect(messages.some((line) => line.includes('shifted influence'))).toBe(true)
  })

  it('merchant bloc can push trade fair edicts in peacetime prosperity', () => {
    const world = generateWorld(9317)
    const kingdomId = Object.keys(world.kingdoms)[0]
    const policy = world.kingdoms[kingdomId].policy
    policy.courtFaction = 'merchant_bloc'
    policy.factionTension = 12
    policy.activeEdict = 'none'
    policy.courtStability = 72
    for (const settlement of Object.values(world.settlements)) {
      if (settlement.kingdomId === kingdomId) {
        settlement.meta.prosperity = 78
        settlement.meta.foodStress = 4
      }
    }
    for (const key of Object.keys(world.kingdomConflicts)) {
      world.kingdomConflicts[key] = false
    }
    world.turn = 9

    const messages = simulateCourtPolitics(world, new SeededRng(7))
    expect(policy.activeEdict).toBe('trade_fair')
    expect(messages.some((line) => line.includes('merchant bloc'))).toBe(true)
  })

  it('high faction tension can post rivalry mandate contracts', () => {
    const base = generateWorld(9318)
    const kingdomId = Object.keys(base.kingdoms)[0]
    let spawned = false

    for (let seed = 1; seed <= 28 && !spawned; seed += 1) {
      const world = structuredClone(base)
      world.contracts = {}
      const policy = world.kingdoms[kingdomId].policy
      policy.courtFaction = 'war_hawks'
      policy.factionTension = 92
      policy.activeEdict = 'none'
      policy.courtStability = 48
      policy.nobleInfluence = 52
      for (const settlement of Object.values(world.settlements)) {
        if (settlement.kingdomId === kingdomId) {
          settlement.meta.prosperity = 49
          settlement.meta.foodStress = 21
        }
      }
      world.turn = 9
      const messages = simulateCourtPolitics(world, new SeededRng(seed))
      const rivalryContract = Object.values(world.contracts).find(
        (contract) => contract.issuerKingdomId === kingdomId && contract.meta.rivalryIncident === true,
      )
      if (rivalryContract) {
        spawned = true
        expect(messages.some((line) => line.includes('court mandate'))).toBe(true)
        expect(rivalryContract.meta.courtFaction).toBe(world.kingdoms[kingdomId].policy.courtFaction)
        expect(typeof rivalryContract.meta.rivalFaction).toBe('string')
        expect(Number(rivalryContract.meta.minCourtFavor ?? 0)).toBeGreaterThan(0)
      }
    }

    expect(spawned).toBe(true)
  })

  it('high tension can trigger faction truce summits with hybrid contracts', () => {
    const base = generateWorld(9319)
    const kingdomId = Object.keys(base.kingdoms)[0]
    let summitSpawned = false

    for (let seed = 1; seed <= 40 && !summitSpawned; seed += 1) {
      const world = structuredClone(base)
      world.contracts = {}
      const policy = world.kingdoms[kingdomId].policy
      policy.courtFaction = 'merchant_bloc'
      policy.factionTension = 95
      policy.factionTrucePair = 'none'
      policy.factionTruceUntilTurn = -1
      policy.activeEdict = 'none'
      for (const settlement of Object.values(world.settlements)) {
        if (settlement.kingdomId === kingdomId) {
          settlement.meta.prosperity = 52
          settlement.meta.foodStress = 18
        }
      }
      world.turn = 9
      const messages = simulateCourtPolitics(world, new SeededRng(seed))
      const truceContracts = Object.values(world.contracts)
        .filter((contract) => contract.issuerKingdomId === kingdomId && contract.meta.truceIncident === true)
        .sort((a, b) => Number(a.meta.summitStage ?? 0) - Number(b.meta.summitStage ?? 0))
      const truceContract = truceContracts[0]
      const stage2 = truceContracts[1]
      if (truceContract) {
        summitSpawned = true
        expect(messages.some((line) => line.includes('truce summit'))).toBe(true)
        expect(typeof policy.factionTrucePair).toBe('string')
        expect(policy.factionTrucePair).not.toBe('none')
        expect(policy.factionTruceUntilTurn).toBeGreaterThan(world.turn)
        expect(truceContract.meta.minCourtFavorByFaction).toBeDefined()
        expect(typeof truceContract.meta.summitChainId).toBe('string')
        expect(Number(truceContract.meta.summitStage)).toBe(1)
        expect(stage2).toBeDefined()
        expect(stage2?.meta.locked).toBe(true)
      }
    }

    expect(summitSpawned).toBe(true)
  })
})

