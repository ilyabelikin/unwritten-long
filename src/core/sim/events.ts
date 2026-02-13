import { keyFor, neighborsOf } from '../hex'
import { SeededRng } from '../random'
import { clamp } from '../utils'
import { isAtWar, kingdomPairKey, relationBetween, setRelation } from './diplomacy'
import type { Character, Species, World } from '../types'

const wildlifeForTile = (rng: SeededRng): Species => {
  const roll = rng.next()
  if (roll < 0.38) return 'rabbit'
  if (roll < 0.63) return 'deer'
  if (roll < 0.8) return 'boar'
  if (roll < 0.94) return 'wolf'
  return 'bear'
}

const createSimpleCharacter = (
  id: string,
  role: Character['role'],
  species: Species,
  tileId: string,
  name: string,
): Character => ({
  id,
  name,
  role,
  species,
  hp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  maxHp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  ap: 4,
  maxAp: 4,
  age: 3,
  skills: { combat: role === 'monster' ? 6 : role === 'bandit' ? 4 : 2, travel: 3 },
  history: [`Appeared near ${tileId}.`],
  traits: [role === 'migrant' ? 'hopeful' : role === 'bandit' ? 'ruthless' : 'restless'],
  flaws: [role === 'migrant' ? 'weak' : 'reckless'],
  reputation: role === 'migrant' ? 2 : -30,
  location: tileId,
  alive: true,
  inventory: {},
  meta: {},
})

const randomLandTileBy = (
  world: World,
  predicate: (tileId: string) => boolean,
  rng: SeededRng,
): string | undefined => {
  const candidates = world.tileOrder.filter(
    (id) => world.tiles[id].terrain !== 'sea' && world.characters[world.playerId].location !== id && predicate(id),
  )
  if (candidates.length === 0) return undefined
  return candidates[rng.int(0, candidates.length - 1)]
}

export const trySpawnWarRefugee = (world: World, rng: SeededRng, pair: string): string | undefined => {
  const [left, right] = pair.split('|')
  const conflictBorderTiles = world.tileOrder.filter((tileId) => {
    const tile = world.tiles[tileId]
    const tileKingdomId = tile.kingdomId
    if (!tileKingdomId || (tileKingdomId !== left && tileKingdomId !== right)) return false
    return neighborsOf(tile.coord).some((neighbor) => {
      const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
      if (!neighborTile?.kingdomId || neighborTile.kingdomId === tileKingdomId) return false
      return kingdomPairKey(tileKingdomId, neighborTile.kingdomId) === pair
    })
  })
  const fallbackTiles = world.tileOrder.filter((tileId) => {
    const tile = world.tiles[tileId]
    return tile.kingdomId === left || tile.kingdomId === right
  })
  const refugeTargets = Object.values(world.settlements)
    .filter((settlement) => settlement.kingdomId !== left && settlement.kingdomId !== right)
    .sort((a, b) => b.meta.prosperity - a.meta.prosperity)
  const spawnPool = conflictBorderTiles.length > 0 ? conflictBorderTiles : fallbackTiles
  const spawnTile = spawnPool[rng.int(0, Math.max(0, spawnPool.length - 1))]
  const safeTarget = refugeTargets[0]
  if (!spawnTile || !safeTarget) return undefined

  const id = `refugee-${world.turn}-${rng.int(100, 999)}`
  const refugee = createSimpleCharacter(id, 'migrant', 'human', spawnTile, `Refugee ${rng.int(10, 99)}`)
  refugee.meta.targetSettlementId = safeTarget.id
  refugee.meta.refugeeFromConflict = pair
  refugee.meta.pathProgress = 0
  world.characters[id] = refugee
  return `War refugees fled the ${world.kingdoms[left]?.name ?? left}/${world.kingdoms[right]?.name ?? right} frontier.`
}

const currentSettlementForPlayer = (world: World) => {
  const player = world.characters[world.playerId]
  if (!player?.alive) return undefined
  const tile = world.tiles[player.location]
  if (!tile?.settlementId) return undefined
  return world.settlements[tile.settlementId]
}

const kingdomInvolvedInWar = (world: World, kingdomId: string): boolean =>
  Object.keys(world.kingdomConflicts).some((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === kingdomId || right === kingdomId
  })

const hasActiveManhuntGuard = (world: World, kingdomId: string): boolean =>
  Object.values(world.characters).some((character) => {
    if (!character.alive || character.role !== 'guard') return false
    if (character.meta.justiceManhunt !== true) return false
    return character.meta.manhuntKingdomId === kingdomId
  })

export const tryDeclareManhunt = (
  world: World,
  rng: SeededRng,
  kingdomId: string,
): string | undefined => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player?.alive || !settlement || settlement.kingdomId !== kingdomId) return undefined
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return undefined
  const bounty = Number(player.meta.bounty ?? 0)
  if (bounty < policy.guardHostilityBounty + 6) return undefined
  if (hasActiveManhuntGuard(world, kingdomId)) return undefined
  const spawnTile = settlement.tiles[rng.int(0, settlement.tiles.length - 1)]
  const id = `marshal-${world.turn}-${rng.int(100, 999)}`
  const marshal = createSimpleCharacter(id, 'guard', 'human', spawnTile, `${world.kingdoms[kingdomId].name} Marshal`)
  marshal.skills.combat = 7
  marshal.skills.patrol = 6
  marshal.homeSettlementId = settlement.id
  marshal.meta.justiceManhunt = true
  marshal.meta.expiresTurn = world.turn + 16
  marshal.meta.manhuntKingdomId = kingdomId
  if (settlement.tier === 'city') {
    marshal.meta.guardCityId = settlement.id
  }
  world.characters[id] = marshal
  player.meta.manhuntKingdomId = kingdomId
  player.meta.manhuntExpiresTurn = world.turn + 16
  return `${world.kingdoms[kingdomId].name} declared a manhunt and deployed city marshals.`
}

export const tryIssueAmnestyDecree = (world: World, kingdomId: string): string | undefined => {
  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (!player?.alive || !settlement || settlement.kingdomId !== kingdomId) return undefined
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy) return undefined
  const bounty = Number(player.meta.bounty ?? 0)
  if (bounty <= 0) return undefined
  if (policy.tradeStance === 'protectionist' || policy.pardonGoldFactor > 1.2) return undefined
  if (kingdomInvolvedInWar(world, kingdomId)) return undefined

  const reduction = clamp(
    Math.round(policy.bountyDecayPerTick * 3 + (1.2 - policy.pardonGoldFactor) * 4),
    4,
    16,
  )
  player.meta.bounty = Math.max(0, bounty - reduction)
  player.reputation += 2
  world.playerKingdomFavor[kingdomId] = clamp((world.playerKingdomFavor[kingdomId] ?? 0) + 1, 0, 100)
  return `${world.kingdoms[kingdomId].name} announced an amnesty decree. Your bounty fell by ${reduction}.`
}

export const tryCorruptionCrackdown = (
  world: World,
  kingdomId: string,
): string | undefined => {
  const kingdom = world.kingdoms[kingdomId]
  if (!kingdom) return undefined
  const policy = kingdom.policy
  const crisis = policy.tradeStance === 'protectionist' || policy.pardonGoldFactor > 1.15 || kingdomInvolvedInWar(world, kingdomId)
  if (!crisis) return undefined

  policy.guardHostilityReputation = clamp(Math.round(policy.guardHostilityReputation + 2), -30, -6)
  policy.guardHostilityBounty = clamp(Math.round(policy.guardHostilityBounty - 2), 10, 34)
  policy.bountyDecayPerTick = clamp(Math.round(policy.bountyDecayPerTick - 1), 1, 5)
  policy.pardonGoldFactor = clamp(policy.pardonGoldFactor + 0.08, 0.6, 1.8)

  const player = world.characters[world.playerId]
  const settlement = currentSettlementForPlayer(world)
  if (player?.alive && settlement?.kingdomId === kingdomId) {
    const bounty = Number(player.meta.bounty ?? 0)
    if (bounty > 0) {
      player.meta.bounty = clamp(bounty + 3, 0, 9999)
    }
  }

  return `${kingdom.name} launched anti-corruption crackdowns, tightening legal enforcement.`
}

export const simulateJusticeEvents = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const player = world.characters[world.playerId]
  if (!player?.alive) return messages
  const currentSettlement = currentSettlementForPlayer(world)

  if (world.turn % 8 === 0 && currentSettlement) {
    const kingdomId = currentSettlement.kingdomId
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const strictChance = clamp(
        0.24 +
          (policy.guardHostilityReputation > -15 ? 0.18 : 0) +
          (policy.guardHostilityBounty < 18 ? 0.16 : 0),
        0.1,
        0.68,
      )
      if (rng.chance(strictChance)) {
        const message = tryDeclareManhunt(world, rng, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  if (world.turn % 10 === 0 && currentSettlement) {
    const kingdomId = currentSettlement.kingdomId
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const amnestyChance = policy.tradeStance === 'open' ? 0.32 : policy.tradeStance === 'balanced' ? 0.16 : 0.05
      if (rng.chance(amnestyChance)) {
        const message = tryIssueAmnestyDecree(world, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  if (world.turn % 14 === 0) {
    const kingdomIds = Object.keys(world.kingdoms)
    const kingdomId = kingdomIds[rng.int(0, kingdomIds.length - 1)]
    const policy = world.kingdoms[kingdomId]?.policy
    if (policy) {
      const crackdownChance =
        policy.tradeStance === 'protectionist'
          ? 0.46
          : kingdomInvolvedInWar(world, kingdomId)
            ? 0.3
            : 0.12
      if (rng.chance(crackdownChance)) {
        const message = tryCorruptionCrackdown(world, kingdomId)
        if (message) messages.push(message)
      }
    }
  }

  return messages
}

const averageProsperityForKingdom = (world: World, kingdomId: string): number => {
  const settlements = Object.values(world.settlements).filter((settlement) => settlement.kingdomId === kingdomId)
  if (settlements.length === 0) return 45
  return settlements.reduce((sum, settlement) => sum + settlement.meta.prosperity, 0) / settlements.length
}

const warCountForKingdom = (world: World, kingdomId: string): number =>
  Object.keys(world.kingdomConflicts).filter((pair) => {
    if (!world.kingdomConflicts[pair]) return false
    const [left, right] = pair.split('|')
    return left === kingdomId || right === kingdomId
  }).length

const isEdictExpired = (world: World, kingdomId: string): boolean => {
  const policy = world.kingdoms[kingdomId]?.policy
  if (!policy || policy.activeEdict === 'none') return false
  return policy.edictExpiresTurn >= 0 && world.turn > policy.edictExpiresTurn
}

export const simulateCourtPolitics = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const kingdomIds = Object.keys(world.kingdoms)

  for (const kingdomId of kingdomIds) {
    const policy = world.kingdoms[kingdomId]?.policy
    if (!policy) continue
    if (isEdictExpired(world, kingdomId)) {
      messages.push(`${world.kingdoms[kingdomId].name}'s ${policy.activeEdict.replace('_', ' ')} edict expired.`)
      policy.activeEdict = 'none'
      policy.edictExpiresTurn = -1
    }
  }

  if (world.turn % 9 !== 0) return messages

  for (const kingdomId of kingdomIds) {
    const kingdom = world.kingdoms[kingdomId]
    const policy = kingdom.policy
    const prosperity = averageProsperityForKingdom(world, kingdomId)
    const wars = warCountForKingdom(world, kingdomId)

    policy.courtStability = clamp(
      Math.round(policy.courtStability + (prosperity >= 58 ? 2 : -2) - wars * 2 + (policy.tradeStance === 'open' ? 1 : 0)),
      0,
      100,
    )
    policy.nobleInfluence = clamp(
      Math.round(policy.nobleInfluence + (policy.taxRate >= 0.16 ? 2 : 0) + wars - (prosperity >= 60 ? 1 : 0)),
      0,
      100,
    )

    if (policy.courtStability <= 30 && policy.nobleInfluence >= 58 && rng.chance(0.55)) {
      policy.activeEdict = 'martial_law'
      policy.edictExpiresTurn = world.turn + 15
      policy.tradeStance = 'protectionist'
      policy.guardHostilityReputation = clamp(policy.guardHostilityReputation + 2, -30, -6)
      policy.guardHostilityBounty = clamp(policy.guardHostilityBounty - 2, 10, 34)
      const otherId = kingdomIds.filter((id) => id !== kingdomId).sort((left, right) =>
        relationBetween(world, kingdomId, left) - relationBetween(world, kingdomId, right),
      )[0]
      if (otherId) setRelation(world, kingdomId, otherId, relationBetween(world, kingdomId, otherId) - 6)
      messages.push(`${kingdom.name} suffered a noble court coup and imposed martial law.`)
      continue
    }

    if (policy.activeEdict === 'none' && prosperity < 38 && rng.chance(0.34)) {
      policy.activeEdict = 'tax_relief'
      policy.edictExpiresTurn = world.turn + 12
      policy.taxRate = clamp(policy.taxRate - 0.01, 0.05, 0.28)
      messages.push(`${kingdom.name} enacted a court-backed tax relief edict to calm unrest.`)
      continue
    }

    if (policy.activeEdict === 'none' && prosperity > 62 && wars === 0 && rng.chance(0.3)) {
      policy.activeEdict = 'trade_fair'
      policy.edictExpiresTurn = world.turn + 12
      policy.tradeStance = 'open'
      const partnerId = kingdomIds
        .filter((id) => id !== kingdomId)
        .sort((left, right) => relationBetween(world, kingdomId, right) - relationBetween(world, kingdomId, left))[0]
      if (partnerId) setRelation(world, kingdomId, partnerId, relationBetween(world, kingdomId, partnerId) + 5)
      messages.push(`${kingdom.name} announced a grand trade fair edict from its royal court.`)
    }
  }

  return messages
}

export const spawnWorldEvents = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const spawn = (character: Character): void => {
    if (world.characters[character.id]) return
    world.characters[character.id] = character
  }

  const chanceScale = world.season === 'winter' ? 0.85 : 1

  if (rng.chance(0.17 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].road, rng)
    if (tileId) {
      const id = `bandit-${world.turn}-${rng.int(100, 999)}`
      const bandit = createSimpleCharacter(id, 'bandit', 'human', tileId, `Bandit ${rng.int(10, 99)}`)
      bandit.meta.hostile = true
      spawn(bandit)
      messages.push('Bandits were spotted on a major road.')
    }
  }

  if (rng.chance(0.14 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].terrain === 'mountain', rng)
    if (tileId) {
      const id = `monster-${world.turn}-${rng.int(100, 999)}`
      const monster = createSimpleCharacter(
        id,
        'monster',
        rng.chance(0.65) ? 'ogre' : 'wyrm',
        tileId,
        rng.chance(0.65) ? 'Ogre' : 'Wyrm',
      )
      spawn(monster)
      messages.push('A roaming monster emerged from the highlands.')
    }
  }

  if (rng.chance(0.12)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].vegetation === 'deep_forest', rng)
    if (tileId) {
      const species = wildlifeForTile(rng)
      const id = `wild-${world.turn}-${rng.int(100, 999)}`
      spawn(createSimpleCharacter(id, 'wildlife', species, tileId, species))
      messages.push(`${species} were seen in the deep forests.`)
    }
  }

  if (rng.chance(0.11)) {
    const settlement = Object.values(world.settlements).sort((a, b) => a.populationIds.length - b.populationIds.length)[0]
    const target = Object.values(world.settlements).sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    if (settlement && target && settlement.id !== target.id) {
      const id = `migrant-${world.turn}-${rng.int(100, 999)}`
      const migrant = createSimpleCharacter(id, 'migrant', 'human', settlement.tiles[0], `Migrant ${rng.int(10, 99)}`)
      migrant.meta.targetSettlementId = target.id
      migrant.meta.pathProgress = 0
      spawn(migrant)
      messages.push(`Migrants left ${settlement.name} for ${target.name}.`)
    }
  }

  if (rng.chance(world.season === 'winter' ? 0.08 : 0.03)) {
    const city = Object.values(world.settlements).find((s) => s.tier === 'city')
    if (city) {
      const ring = city.tiles.flatMap((tileId) =>
        neighborsOf(world.tiles[tileId].coord).map((n) => keyFor(n.q, n.r)),
      )
      const candidates = ring.filter((id) => world.tiles[id] && world.tiles[id].terrain !== 'sea')
      const tileId = candidates[rng.int(0, Math.max(0, candidates.length - 1))]
      if (tileId) {
        const id = `raid-${world.turn}-${rng.int(100, 999)}`
        const monster = createSimpleCharacter(id, 'monster', 'ogre', tileId, 'Raider Ogre')
        spawn(monster)
        messages.push(`A raiding monster approaches ${city.name}.`)
      }
    }
  }

  const warPairs = Object.keys(world.kingdomConflicts).filter((pair) => world.kingdomConflicts[pair])
  if (warPairs.length > 0 && world.turn % 9 === 0 && rng.chance(0.65)) {
    const selectedPair = warPairs[rng.int(0, warPairs.length - 1)]
    const [leftKingdom, rightKingdom] = selectedPair.split('|')
    if (isAtWar(world, leftKingdom, rightKingdom)) {
      const borderTiles = world.tileOrder.filter((tileId) => {
        const tile = world.tiles[tileId]
        if (tile.kingdomId !== leftKingdom && tile.kingdomId !== rightKingdom) return false
        return neighborsOf(tile.coord).some((neighbor) => {
          const neighborTile = world.tiles[keyFor(neighbor.q, neighbor.r)]
          if (!neighborTile || neighborTile.terrain === 'sea') return false
          return kingdomPairKey(tile.kingdomId ?? '', neighborTile.kingdomId ?? '') === selectedPair
        })
      })

      const spawnTile = borderTiles[rng.int(0, Math.max(0, borderTiles.length - 1))]
      if (spawnTile) {
        const id = `warband-${world.turn}-${rng.int(100, 999)}`
        const warband = createSimpleCharacter(id, 'bandit', 'human', spawnTile, 'Warband')
        warband.skills.combat = 6
        warband.meta.hostile = true
        warband.meta.warPair = selectedPair
        spawn(warband)
        messages.push(
          `${world.kingdoms[leftKingdom]?.name ?? leftKingdom} and ${world.kingdoms[rightKingdom]?.name ?? rightKingdom} clashed at the frontier.`,
        )
      }
    }
  }

  if (warPairs.length > 0 && world.turn % 7 === 0 && rng.chance(0.55)) {
    const pair = warPairs[rng.int(0, warPairs.length - 1)]
    const refugeeMessage = trySpawnWarRefugee(world, rng, pair)
    if (refugeeMessage) messages.push(refugeeMessage)
  }

  return messages
}

