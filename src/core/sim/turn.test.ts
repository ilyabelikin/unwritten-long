import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import {
  advanceWorldTurn,
  determineSeasonFromTurn,
  movementCost,
  playerDonateSupplies,
  playerCoordinateEscort,
  playerRequestPardon,
  playerRallyMilitia,
  playerRob,
  playerSponsorTreaty,
} from './turn'
import { relationBetween, setRelation, setWarState } from './diplomacy'
import { parseKey } from '../hex'
import { cityGuardSpawnTiles } from './combat'

describe('turn simulation', () => {
  it('advances season correctly every 60 turns', () => {
    expect(determineSeasonFromTurn(0).season).toBe('spring')
    expect(determineSeasonFromTurn(60).season).toBe('summer')
    expect(determineSeasonFromTurn(120).season).toBe('autumn')
    expect(determineSeasonFromTurn(180).season).toBe('winter')
  })

  it('advances world turn and refreshes player AP', () => {
    const world = generateWorld(101)
    const player = world.characters[world.playerId]
    player.ap = 0
    advanceWorldTurn(world, 3)
    expect(world.turn).toBe(1)
    expect(player.ap).toBe(player.maxAp)
    expect(world.messages.length).toBeGreaterThan(0)
  })

  it('movement on roads remains low cost', () => {
    const world = generateWorld(212)
    const roadTile = world.tileOrder.find((id) => world.tiles[id].road)!
    const neighborRoad = world.tileOrder.find((id) => {
      if (!world.tiles[id].road || id === roadTile) return false
      const from = world.tiles[roadTile].coord
      const to = world.tiles[id].coord
      return Math.abs(from.q - to.q) <= 1 && Math.abs(from.r - to.r) <= 1
    })
    if (!neighborRoad) return
    expect(movementCost(world, roadTile, neighborRoad)).toBe(1)
  })

  it('applies elevation and terrain movement modifiers', () => {
    const world = generateWorld(313)
    const start = world.tileOrder.find((id) => world.tiles[id].terrain !== 'sea')!
    const target = world.tileOrder.find((id) => id !== start && world.tiles[id].terrain !== 'sea')!

    world.tiles[start].road = false
    world.tiles[target].road = false
    world.tiles[start].elevation = 1
    world.tiles[target].elevation = 3
    world.tiles[target].terrain = 'plains'
    world.tiles[target].vegetation = 'none'
    world.tiles[target].rough = false
    expect(movementCost(world, start, target)).toBe(3)

    world.tiles[target].terrain = 'mountain'
    world.tiles[target].elevation = 2
    world.tiles[target].rough = true
    expect(movementCost(world, start, target)).toBe(3)
  })

  it('stays stable over many world turns', () => {
    const world = generateWorld(9088)
    for (let i = 0; i < 90; i += 1) {
      advanceWorldTurn(world, i)
    }
    const player = world.characters[world.playerId]
    expect(world.turn).toBe(90)
    expect(Number.isFinite(player.hp)).toBe(true)
    expect(typeof player.alive).toBe('boolean')
    for (const settlement of Object.values(world.settlements)) {
      expect(Number.isFinite(settlement.treasury)).toBe(true)
      expect(settlement.treasury).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(settlement.stockpile.grain)).toBe(true)
      expect(settlement.stockpile.grain).toBeGreaterThanOrEqual(0)
    }
  })

  it('applies bounty when robbery is confirmed', () => {
    const world = generateWorld(9091)
    const player = world.characters[world.playerId]
    world.characters['test-trader'] = {
      id: 'test-trader',
      name: 'Trade Wagon',
      role: 'trader',
      species: 'human',
      hp: 8,
      maxHp: 8,
      ap: 4,
      maxAp: 4,
      age: 30,
      skills: { barter: 5 },
      history: [],
      traits: ['pragmatic'],
      flaws: ['frail'],
      reputation: 0,
      location: player.location,
      homeSettlementId: Object.values(world.settlements)[0].id,
      targetTileId: undefined,
      alive: true,
      inventory: { fish: 4 },
      meta: { homeSettlementId: Object.values(world.settlements)[0].id },
    }

    const first = playerRob(world, 'test-trader', false)
    expect(first[0]).toContain('Confirm?')
    expect(world.pendingRobberyCharacterId).toBe('test-trader')

    const second = playerRob(world, 'test-trader', true)
    expect(second[0]).toContain('Bounty')
    expect(Number(player.meta.bounty ?? 0)).toBeGreaterThan(0)
  })

  it('donating supplies improves settlement morale and lowers bounty', () => {
    const world = generateWorld(9092)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    player.inventory.grain = 3
    player.inventory.fish = 1
    player.meta.bounty = 22
    const stressBefore = settlement.meta.foodStress
    const repBefore = player.reputation

    const messages = playerDonateSupplies(world)
    expect(messages[0]).toContain('donated')
    expect(settlement.meta.foodStress).toBeLessThanOrEqual(stressBefore)
    expect(player.reputation).toBeGreaterThan(repBefore)
    expect(Number(player.meta.bounty ?? 0)).toBeLessThan(22)
  })

  it('sponsoring treaty can improve relations and end war', () => {
    const world = generateWorld(9093)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const localKingdom = world.settlements[settlementId].kingdomId
    const foreign = Object.keys(world.kingdoms).find((id) => id !== localKingdom)
    expect(foreign).toBeDefined()
    if (!foreign) return

    setRelation(world, localKingdom, foreign, -12)
    setWarState(world, localKingdom, foreign, true)
    player.inventory.gold_ore = 2
    const before = world.kingdomRelations[[localKingdom, foreign].sort().join('|')]

    const messages = playerSponsorTreaty(world)
    const after = world.kingdomRelations[[localKingdom, foreign].sort().join('|')]
    expect(messages[0]).toContain('sponsored talks')
    expect(messages.some((line) => line.includes('peace corridor'))).toBe(true)
    expect(after).toBeGreaterThan(before)
    expect(world.kingdomConflicts[[localKingdom, foreign].sort().join('|')]).toBe(false)
    expect(world.kingdoms[localKingdom].policy.peaceDividendPartnerKingdomId).toBe(foreign)
    expect(world.kingdoms[foreign].policy.peaceDividendPartnerKingdomId).toBe(localKingdom)
    expect(world.kingdoms[localKingdom].policy.peaceDividendUntilTurn).toBeGreaterThanOrEqual(world.turn)
  })

  it('guards prioritize nearby warband threats during conflict', () => {
    const world = generateWorld(9094)
    const guard = Object.values(world.characters).find((character) => character.role === 'guard')
    expect(guard).toBeDefined()
    if (!guard) return

    const guardSettlementId = guard.homeSettlementId
    expect(guardSettlementId).toBeDefined()
    if (!guardSettlementId) return
    const guardKingdom = world.settlements[guardSettlementId].kingdomId
    const enemyKingdom = Object.keys(world.kingdoms).find((id) => id !== guardKingdom)
    expect(enemyKingdom).toBeDefined()
    if (!enemyKingdom) return
    setWarState(world, guardKingdom, enemyKingdom, true)
    setRelation(world, guardKingdom, enemyKingdom, -70)

    const guardPatrolTiles = cityGuardSpawnTiles(world)
      .filter((tileId) => tileId !== guard.location)
      .sort((a, b) => {
        const ad = Math.abs(parseKey(a).q - parseKey(guard.location).q) +
          Math.abs(parseKey(a).r - parseKey(guard.location).r)
        const bd = Math.abs(parseKey(b).q - parseKey(guard.location).q) +
          Math.abs(parseKey(b).r - parseKey(guard.location).r)
        return ad - bd
      })
    const destination = guardPatrolTiles[0] ?? guard.location
    world.characters['warband-test'] = {
      id: 'warband-test',
      name: 'Warband',
      role: 'bandit',
      species: 'human',
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 30,
      skills: { combat: 6 },
      history: [],
      traits: ['ruthless'],
      flaws: ['reckless'],
      reputation: -30,
      location: destination,
      alive: true,
      inventory: {},
      meta: { warPair: [guardKingdom, enemyKingdom].sort().join('|') },
    }

    const startDistance = Math.abs(parseKey(guard.location).q - parseKey(destination).q) +
      Math.abs(parseKey(guard.location).r - parseKey(destination).r)
    const player = world.characters[world.playerId]
    player.reputation = 10
    player.meta.bounty = 0

    advanceWorldTurn(world, 2)

    const endDistance = Math.abs(parseKey(guard.location).q - parseKey(destination).q) +
      Math.abs(parseKey(guard.location).r - parseKey(destination).r)
    expect(endDistance).toBeLessThanOrEqual(startDistance)
  })

  it('city pardon clears bounty when payment is provided', () => {
    const world = generateWorld(9095)
    const citySettlement = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(citySettlement).toBeDefined()
    if (!citySettlement) return
    const player = world.characters[world.playerId]
    player.location = citySettlement.tiles[0]
    player.meta.bounty = 42
    player.inventory.gold_ore = 3
    const reputationBefore = player.reputation

    const messages = playerRequestPardon(world)
    expect(messages[0]).toContain('granted a pardon')
    expect(Number(player.meta.bounty ?? 0)).toBe(0)
    expect(player.reputation).toBeGreaterThan(reputationBefore)
    expect(player.inventory.gold_ore ?? 0).toBeLessThan(3)
  })

  it('settlement kingdom policy controls bounty decay amount', () => {
    const world = generateWorld(9099)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = world.settlements[settlementId].kingdomId
    world.kingdoms[kingdomId].policy.bountyDecayPerTick = 4
    player.meta.bounty = 22
    world.turn = 4
    advanceWorldTurn(world, 4)
    expect(Number(player.meta.bounty ?? 0)).toBe(18)
  })

  it('peace-corridor settlements grant extra bounty decay leniency', () => {
    const world = generateWorld(9104)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = world.settlements[settlementId].kingdomId
    const partnerId = Object.keys(world.kingdoms).find((id) => id !== kingdomId)
    expect(partnerId).toBeDefined()
    if (!partnerId) return
    world.kingdoms[kingdomId].policy.bountyDecayPerTick = 2
    world.kingdoms[kingdomId].policy.peaceDividendPartnerKingdomId = partnerId
    world.kingdoms[partnerId].policy.peaceDividendPartnerKingdomId = kingdomId
    world.kingdoms[kingdomId].policy.peaceDividendUntilTurn = 20
    world.kingdoms[partnerId].policy.peaceDividendUntilTurn = 20
    world.kingdoms[kingdomId].policy.peaceDividendIntensity = 26
    world.kingdoms[partnerId].policy.peaceDividendIntensity = 26
    setRelation(world, kingdomId, partnerId, 18)
    setWarState(world, kingdomId, partnerId, false)
    player.meta.bounty = 30
    world.turn = 4
    advanceWorldTurn(world, 8)
    expect(Number(player.meta.bounty ?? 0)).toBe(27)
  })

  it('martial law edicts reduce bounty decay and harden pardon cost', () => {
    const world = generateWorld(9111)
    const citySettlement = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(citySettlement).toBeDefined()
    if (!citySettlement) return
    const player = world.characters[world.playerId]
    player.location = citySettlement.tiles[0]
    player.meta.bounty = 35
    player.inventory.gold_ore = 1
    const policy = world.kingdoms[citySettlement.kingdomId].policy
    policy.bountyDecayPerTick = 3
    policy.pardonGoldFactor = 1
    policy.activeEdict = 'martial_law'
    policy.edictExpiresTurn = world.turn + 30

    world.turn = 4
    advanceWorldTurn(world, 9)
    expect(Number(player.meta.bounty ?? 0)).toBe(33)

    const denied = playerRequestPardon(world)
    expect(denied[0]).toContain('requires 2 gold ore')
  })

  it('pardon cost scales with kingdom legal policy factor', () => {
    const world = generateWorld(9100)
    const citySettlement = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(citySettlement).toBeDefined()
    if (!citySettlement) return
    const player = world.characters[world.playerId]
    player.location = citySettlement.tiles[0]
    player.meta.bounty = 70
    player.inventory.gold_ore = 3
    player.inventory.tools = 0
    world.kingdoms[citySettlement.kingdomId].policy.pardonGoldFactor = 1.6

    const denied = playerRequestPardon(world)
    expect(denied[0]).toContain('requires 4 gold ore')

    player.inventory.gold_ore = 4
    const approved = playerRequestPardon(world)
    expect(approved[0]).toContain('granted a pardon')
    expect(Number(player.meta.bounty ?? 0)).toBe(0)
  })

  it('peace corridors can reduce pardon cost through mediation', () => {
    const world = generateWorld(9105)
    const citySettlement = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(citySettlement).toBeDefined()
    if (!citySettlement) return
    const player = world.characters[world.playerId]
    player.location = citySettlement.tiles[0]
    player.meta.bounty = 105
    player.inventory.gold_ore = 4
    const kingdomId = citySettlement.kingdomId
    const partnerId = Object.keys(world.kingdoms).find((id) => id !== kingdomId)
    expect(partnerId).toBeDefined()
    if (!partnerId) return

    world.kingdoms[kingdomId].policy.pardonGoldFactor = 1.4
    world.kingdoms[partnerId].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[kingdomId].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[partnerId].policy.peaceDividendPartnerKingdomId = kingdomId
    world.kingdoms[kingdomId].policy.peaceDividendPartnerKingdomId = partnerId
    world.kingdoms[partnerId].policy.peaceDividendIntensity = 22
    world.kingdoms[kingdomId].policy.peaceDividendIntensity = 22
    setWarState(world, kingdomId, partnerId, false)
    setRelation(world, kingdomId, partnerId, 18)

    const messages = playerRequestPardon(world)
    expect(messages[0]).toContain('granted a pardon')
    expect(messages.some((line) => line.includes('mediation'))).toBe(true)
    expect(Number(player.meta.bounty ?? 0)).toBe(0)
    expect(player.inventory.gold_ore ?? 0).toBe(0)
  })

  it('warband bandits march toward enemy kingdom settlements', () => {
    const world = generateWorld(9096)
    const [left, right] = Object.keys(world.kingdoms)
    setWarState(world, left, right, true)
    setRelation(world, left, right, -75)

    const leftSettlement = Object.values(world.settlements).find((settlement) => settlement.kingdomId === left)
    const rightSettlement = Object.values(world.settlements).find((settlement) => settlement.kingdomId === right)
    expect(leftSettlement).toBeDefined()
    expect(rightSettlement).toBeDefined()
    if (!leftSettlement || !rightSettlement) return

    const startTile = leftSettlement.tiles[0]
    world.characters['warband-march'] = {
      id: 'warband-march',
      name: 'Warband',
      role: 'bandit',
      species: 'human',
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 25,
      skills: { combat: 6 },
      history: [],
      traits: ['ruthless'],
      flaws: ['reckless'],
      reputation: -40,
      location: startTile,
      homeSettlementId: leftSettlement.id,
      targetTileId: rightSettlement.tiles[0],
      alive: true,
      inventory: {},
      meta: { warPair: [left, right].sort().join('|') },
    }

    const before =
      Math.abs(parseKey(startTile).q - parseKey(rightSettlement.tiles[0]).q) +
      Math.abs(parseKey(startTile).r - parseKey(rightSettlement.tiles[0]).r)
    advanceWorldTurn(world, 3)
    const moved = world.characters['warband-march'].location
    const after =
      Math.abs(parseKey(moved).q - parseKey(rightSettlement.tiles[0]).q) +
      Math.abs(parseKey(moved).r - parseKey(rightSettlement.tiles[0]).r)
    expect(after).toBeLessThanOrEqual(before)
  })

  it('rallied militia appears and later disbands', () => {
    const world = generateWorld(9097)
    const player = world.characters[world.playerId]
    player.inventory.tools = 2
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return

    const messages = playerRallyMilitia(world)
    expect(messages[0]).toContain('rallied militia')
    const militia = Object.values(world.characters).find(
      (character) => character.role === 'guard' && Boolean(character.meta.militia),
    )
    expect(militia).toBeDefined()
    if (!militia) return

    const expires = Number(militia.meta.expiresTurn)
    while (world.turn <= expires) {
      advanceWorldTurn(world, world.turn)
    }
    expect(militia.alive).toBe(false)
  })

  it('repatriating refugees settle with returning-home recovery bonus', () => {
    const world = generateWorld(9102)
    const target = Object.values(world.settlements)[0]
    const template = world.characters[world.playerId]
    world.characters['returnee-test'] = {
      ...template,
      id: 'returnee-test',
      name: 'Returnee',
      role: 'migrant',
      location: target.tiles[0],
      homeSettlementId: undefined,
      targetTileId: undefined,
      alive: true,
      inventory: {},
      meta: {
        targetSettlementId: target.id,
        returningHome: true,
        refugeeFromConflict: Object.keys(world.kingdomRelations)[0],
      },
    }
    const messages = advanceWorldTurn(world, 12)
    const returnee = world.characters['returnee-test']
    expect(returnee.role).toBe('villager')
    expect(returnee.homeSettlementId).toBe(target.id)
    expect(target.populationIds).toContain('returnee-test')
    expect(messages.some((line) => line.includes('returned home'))).toBe(true)
  })

  it('coordinating escort marks caravan contact for active contract', () => {
    const world = generateWorld(9098)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const destination = Object.values(world.settlements).find((candidate) => candidate.id !== settlementId)
    expect(destination).toBeDefined()
    if (!destination) return

    const contractId = `escort-active-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'escort_caravan',
      level: 2,
      status: 'active',
      assignedCharacterId: player.id,
      requiredAmount: 8,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 6,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {
        destinationSettlementId: destination.id,
        playerMetCaravan: false,
        caravanDelivered: false,
      },
    }
    world.characters['escort-trader'] = {
      id: 'escort-trader',
      name: 'Escort Caravan',
      role: 'trader',
      species: 'human',
      hp: 6,
      maxHp: 8,
      ap: 4,
      maxAp: 4,
      age: 25,
      skills: { travel: 5, combat: 2 },
      history: [],
      traits: ['cautious'],
      flaws: ['fragile'],
      reputation: 0,
      location: player.location,
      homeSettlementId: destination.id,
      targetTileId: destination.tiles[0],
      alive: true,
      inventory: { grain: 8 },
      meta: { contractId },
    }
    const playerApBefore = player.ap
    const result = playerCoordinateEscort(world, 'escort-trader')
    expect(result[0]).toContain('coordinated')
    expect(world.contracts[contractId].meta.playerMetCaravan).toBe(true)
    expect(player.ap).toBeLessThan(playerApBefore)
  })

  it('losing a peace-corridor escort can collapse fragile peace dividends', () => {
    const world = generateWorld(9103)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const issuerKingdomId = settlement.kingdomId
    const partnerKingdomId = Object.keys(world.kingdoms).find((id) => id !== issuerKingdomId)
    expect(partnerKingdomId).toBeDefined()
    if (!partnerKingdomId) return

    const issuerPolicy = world.kingdoms[issuerKingdomId].policy
    const partnerPolicy = world.kingdoms[partnerKingdomId].policy
    issuerPolicy.peaceDividendUntilTurn = world.turn + 10
    partnerPolicy.peaceDividendUntilTurn = world.turn + 10
    issuerPolicy.peaceDividendPartnerKingdomId = partnerKingdomId
    partnerPolicy.peaceDividendPartnerKingdomId = issuerKingdomId
    issuerPolicy.peaceDividendIntensity = 4
    partnerPolicy.peaceDividendIntensity = 4
    setRelation(world, issuerKingdomId, partnerKingdomId, 10)
    const relationBefore = relationBetween(world, issuerKingdomId, partnerKingdomId)

    const contractId = `escort-lost-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId,
      kind: 'escort_caravan',
      level: 2,
      status: 'active',
      assignedCharacterId: player.id,
      requiredAmount: 8,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 6,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 12,
      meta: {
        peaceDividendOpportunity: true,
        peaceDividendPartnerKingdomId: partnerKingdomId,
        caravanId: 'lost-caravan',
        caravanDelivered: false,
      },
    }

    const messages = advanceWorldTurn(world, 18)
    expect(world.contracts[contractId].status).toBe('expired')
    expect(messages.some((line) => line.includes('Escort contract'))).toBe(true)
    expect(messages.some((line) => line.includes('Peace dividend momentum collapsed'))).toBe(true)
    expect(issuerPolicy.peaceDividendIntensity).toBe(0)
    expect(partnerPolicy.peaceDividendIntensity).toBe(0)
    expect(issuerPolicy.peaceDividendUntilTurn).toBe(-1)
    expect(partnerPolicy.peaceDividendUntilTurn).toBe(-1)
    expect(issuerPolicy.peaceDividendPartnerKingdomId).toBe('none')
    expect(partnerPolicy.peaceDividendPartnerKingdomId).toBe('none')
    expect(relationBetween(world, issuerKingdomId, partnerKingdomId)).toBeLessThan(relationBefore)
  })

  it('can trigger justice manhunts on world turns for notorious players', () => {
    const base = generateWorld(9101)
    const player = base.characters[base.playerId]
    const settlementId = base.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const kingdomId = base.settlements[settlementId].kingdomId
    base.kingdoms[kingdomId].policy.guardHostilityBounty = 12
    base.kingdoms[kingdomId].policy.guardHostilityReputation = -10
    player.meta.bounty = 40
    base.turn = 7

    let triggered = false
    for (let seed = 1; seed <= 24 && !triggered; seed += 1) {
      const world = structuredClone(base)
      const messages = advanceWorldTurn(world, seed)
      triggered = messages.some((line) => line.includes('declared a manhunt'))
      if (triggered) {
        expect(world.characters[world.playerId].meta.manhuntKingdomId).toBe(kingdomId)
      }
    }

    expect(triggered).toBe(true)
  })
})

