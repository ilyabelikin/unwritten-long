import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { setRelation, setWarState } from './diplomacy'
import { tryCorruptionCrackdown, tryDeclareManhunt, tryIssueAmnestyDecree, trySpawnWarRefugee } from './events'

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
})

