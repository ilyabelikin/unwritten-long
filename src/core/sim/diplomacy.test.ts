import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import {
  isAtWar,
  relationBetween,
  resolveDiplomaticIncidentForPair,
  setRelation,
  setWarState,
  simulateDiplomacyTurn,
} from './diplomacy'

describe('diplomacy simulation', () => {
  it('initializes relation entries for every kingdom pair', () => {
    const world = generateWorld(9901)
    const ids = Object.keys(world.kingdoms)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const relation = relationBetween(world, ids[i], ids[j])
        expect(Number.isFinite(relation)).toBe(true)
      }
    }
  })

  it('updates relations on diplomacy ticks', () => {
    const world = generateWorld(9902)
    world.turn = 12
    const ids = Object.keys(world.kingdoms)
    const before = relationBetween(world, ids[0], ids[1])
    simulateDiplomacyTurn(world, new SeededRng(24))
    const after = relationBetween(world, ids[0], ids[1])
    expect(after).not.toBe(before)
  })

  it('declares and resolves wars from relation thresholds', () => {
    const world = generateWorld(9903)
    const ids = Object.keys(world.kingdoms)
    const [left, right] = [ids[0], ids[1]]

    setRelation(world, left, right, -85)
    world.turn = 12
    simulateDiplomacyTurn(world, new SeededRng(3))
    expect(isAtWar(world, left, right)).toBe(true)

    setRelation(world, left, right, 55)
    world.turn = 24
    simulateDiplomacyTurn(world, new SeededRng(4))
    expect(isAtWar(world, left, right)).toBe(false)
  })

  it('assigns kingdom policy defaults', () => {
    const world = generateWorld(9904)
    for (const kingdom of Object.values(world.kingdoms)) {
      expect(kingdom.policy.taxRate).toBeGreaterThan(0)
      expect(kingdom.policy.patrolFocus).toBeGreaterThan(0)
      expect(['open', 'balanced', 'protectionist']).toContain(kingdom.policy.tradeStance)
      expect(kingdom.policy.guardHostilityReputation).toBeLessThanOrEqual(-6)
      expect(kingdom.policy.guardHostilityBounty).toBeGreaterThanOrEqual(10)
      expect(kingdom.policy.bountyDecayPerTick).toBeGreaterThan(0)
      expect(kingdom.policy.pardonGoldFactor).toBeGreaterThan(0)
      expect(kingdom.policy.courtStability).toBeGreaterThanOrEqual(0)
      expect(kingdom.policy.nobleInfluence).toBeGreaterThanOrEqual(0)
      expect(['merchant_bloc', 'war_hawks', 'reformers']).toContain(kingdom.policy.courtFaction)
      expect(kingdom.policy.factionTension).toBeGreaterThanOrEqual(0)
      expect(typeof kingdom.policy.factionTrucePair).toBe('string')
      expect(Number.isFinite(kingdom.policy.factionTruceUntilTurn)).toBe(true)
      expect(Number.isFinite(kingdom.policy.peaceDividendUntilTurn)).toBe(true)
      expect(typeof kingdom.policy.peaceDividendPartnerKingdomId).toBe('string')
      expect(kingdom.policy.peaceDividendIntensity).toBeGreaterThanOrEqual(0)
      expect(['none', 'martial_law', 'tax_relief', 'trade_fair']).toContain(kingdom.policy.activeEdict)
    }
  })

  it('can trigger positive trade charter incidents', () => {
    const world = generateWorld(9905)
    for (const key of Object.keys(world.kingdomRelations)) {
      world.kingdomRelations[key] = 70
      world.kingdomConflicts[key] = false
    }
    const capitals = Object.values(world.kingdoms)
      .map((kingdom) => kingdom.capitalSettlementId)
      .filter((id): id is string => Boolean(id))
      .map((id) => world.settlements[id])
      .filter(Boolean)
    const treasuryBefore = capitals.reduce((total, settlement) => total + settlement.treasury, 0)
    world.turn = 36
    const messages = simulateDiplomacyTurn(world, new SeededRng(41))
    const treasuryAfter = capitals.reduce((total, settlement) => total + settlement.treasury, 0)
    expect(messages.some((line) => line.includes('trade charter'))).toBe(true)
    expect(treasuryAfter).toBeGreaterThan(treasuryBefore)
  })

  it('peace corridors boost trade-charter treasury outcomes', () => {
    const base = generateWorld(9908)
    const [left, right] = Object.keys(base.kingdoms)
    base.turn = 18
    setRelation(base, left, right, 62)
    setWarState(base, left, right, false)

    const withCorridor = structuredClone(base)
    const withoutCorridor = structuredClone(base)
    withCorridor.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    withCorridor.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    withCorridor.kingdoms[left].policy.peaceDividendUntilTurn = withCorridor.turn + 10
    withCorridor.kingdoms[right].policy.peaceDividendUntilTurn = withCorridor.turn + 10
    withCorridor.kingdoms[left].policy.peaceDividendIntensity = 32
    withCorridor.kingdoms[right].policy.peaceDividendIntensity = 32

    const leftCapitalA = withCorridor.kingdoms[left].capitalSettlementId
    const rightCapitalA = withCorridor.kingdoms[right].capitalSettlementId
    const leftCapitalB = withoutCorridor.kingdoms[left].capitalSettlementId
    const rightCapitalB = withoutCorridor.kingdoms[right].capitalSettlementId
    expect(leftCapitalA).toBeDefined()
    expect(rightCapitalA).toBeDefined()
    expect(leftCapitalB).toBeDefined()
    expect(rightCapitalB).toBeDefined()
    if (!leftCapitalA || !rightCapitalA || !leftCapitalB || !rightCapitalB) return

    const beforeA = withCorridor.settlements[leftCapitalA].treasury + withCorridor.settlements[rightCapitalA].treasury
    const beforeB =
      withoutCorridor.settlements[leftCapitalB].treasury + withoutCorridor.settlements[rightCapitalB].treasury
    const messagesA = resolveDiplomaticIncidentForPair(withCorridor, left, right, new SeededRng(19))
    const messagesB = resolveDiplomaticIncidentForPair(withoutCorridor, left, right, new SeededRng(19))
    const afterA = withCorridor.settlements[leftCapitalA].treasury + withCorridor.settlements[rightCapitalA].treasury
    const afterB = withoutCorridor.settlements[leftCapitalB].treasury + withoutCorridor.settlements[rightCapitalB].treasury
    expect(afterA - beforeA).toBeGreaterThan(afterB - beforeB)
    expect(messagesA.some((line) => line.includes('corridor tariff concessions'))).toBe(true)
    expect(messagesB.some((line) => line.includes('corridor tariff concessions'))).toBe(false)
  })

  it('corridor mediation can de-escalate border incidents', () => {
    const base = generateWorld(9909)
    const [left, right] = Object.keys(base.kingdoms)
    base.turn = 18
    setRelation(base, left, right, -28)
    setWarState(base, left, right, false)
    base.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    base.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    base.kingdoms[left].policy.peaceDividendUntilTurn = base.turn + 12
    base.kingdoms[right].policy.peaceDividendUntilTurn = base.turn + 12
    base.kingdoms[left].policy.peaceDividendIntensity = 40
    base.kingdoms[right].policy.peaceDividendIntensity = 40

    let deEscalated = false
    for (let seed = 1; seed <= 36 && !deEscalated; seed += 1) {
      const world = structuredClone(base)
      const messages = resolveDiplomaticIncidentForPair(world, left, right, new SeededRng(seed))
      if (messages.some((line) => line.includes('de-escalated a border dispute'))) {
        deEscalated = true
        expect(relationBetween(world, left, right)).toBeGreaterThan(-28)
      }
    }
    expect(deEscalated).toBe(true)
  })

  it('active corridors nudge legal policy toward leniency', () => {
    const world = generateWorld(9910)
    const [left, right] = Object.keys(world.kingdoms)
    world.turn = 60
    for (const pair of Object.keys(world.kingdomRelations)) {
      world.kingdomRelations[pair] = 14
      world.kingdomConflicts[pair] = false
    }
    setRelation(world, left, right, 24)
    setWarState(world, left, right, false)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[left].policy.peaceDividendIntensity = 30
    world.kingdoms[right].policy.peaceDividendIntensity = 30

    const leftSettlements = Object.values(world.settlements).filter((settlement) => settlement.kingdomId === left)
    for (const settlement of leftSettlements) {
      settlement.meta.prosperity = 58
      settlement.meta.foodStress = 10
    }

    const policy = world.kingdoms[left].policy
    policy.tradeStance = 'protectionist'
    policy.guardHostilityReputation = -14
    policy.guardHostilityBounty = 15
    policy.bountyDecayPerTick = 2
    policy.pardonGoldFactor = 1.2

    simulateDiplomacyTurn(world, new SeededRng(77))
    expect(policy.tradeStance).not.toBe('protectionist')
    expect(policy.guardHostilityReputation).toBeLessThanOrEqual(-15)
    expect(policy.guardHostilityBounty).toBeGreaterThanOrEqual(16)
    expect(policy.bountyDecayPerTick).toBeGreaterThanOrEqual(3)
    expect(policy.pardonGoldFactor).toBeLessThan(1.2)
  })

  it('active peace dividends improve bilateral relations and treasury flow', () => {
    const world = generateWorld(9906)
    const [left, right] = Object.keys(world.kingdoms)
    const leftPolicy = world.kingdoms[left].policy
    const rightPolicy = world.kingdoms[right].policy
    world.turn = 12
    setRelation(world, left, right, 8)
    leftPolicy.peaceDividendUntilTurn = world.turn + 18
    rightPolicy.peaceDividendUntilTurn = world.turn + 18
    leftPolicy.peaceDividendPartnerKingdomId = right
    rightPolicy.peaceDividendPartnerKingdomId = left
    leftPolicy.peaceDividendIntensity = 60
    rightPolicy.peaceDividendIntensity = 60
    const leftCapitalId = world.kingdoms[left].capitalSettlementId
    const rightCapitalId = world.kingdoms[right].capitalSettlementId
    expect(leftCapitalId).toBeDefined()
    expect(rightCapitalId).toBeDefined()
    if (!leftCapitalId || !rightCapitalId) return
    const leftCapital = world.settlements[leftCapitalId]
    const rightCapital = world.settlements[rightCapitalId]
    const treasuryBefore = leftCapital.treasury + rightCapital.treasury
    const relationBefore = relationBetween(world, left, right)

    simulateDiplomacyTurn(world, new SeededRng(44))
    const treasuryAfter = leftCapital.treasury + rightCapital.treasury
    const relationAfter = relationBetween(world, left, right)
    expect(relationAfter).toBeGreaterThan(relationBefore)
    expect(treasuryAfter).toBeGreaterThan(treasuryBefore)
  })

  it('peace-dividend boosts pause while the corridor pair is back at war', () => {
    const world = generateWorld(9911)
    const [left, right] = Object.keys(world.kingdoms)
    const leftPolicy = world.kingdoms[left].policy
    const rightPolicy = world.kingdoms[right].policy
    world.turn = 12
    setRelation(world, left, right, 14)
    setWarState(world, left, right, true)
    leftPolicy.peaceDividendUntilTurn = world.turn + 18
    rightPolicy.peaceDividendUntilTurn = world.turn + 18
    leftPolicy.peaceDividendPartnerKingdomId = right
    rightPolicy.peaceDividendPartnerKingdomId = left
    leftPolicy.peaceDividendIntensity = 44
    rightPolicy.peaceDividendIntensity = 44
    const leftCapitalId = world.kingdoms[left].capitalSettlementId
    const rightCapitalId = world.kingdoms[right].capitalSettlementId
    expect(leftCapitalId).toBeDefined()
    expect(rightCapitalId).toBeDefined()
    if (!leftCapitalId || !rightCapitalId) return
    const leftCapital = world.settlements[leftCapitalId]
    const rightCapital = world.settlements[rightCapitalId]
    const treasuryBefore = leftCapital.treasury + rightCapital.treasury

    simulateDiplomacyTurn(world, new SeededRng(67))
    const treasuryAfter = leftCapital.treasury + rightCapital.treasury
    expect(treasuryAfter).toBe(treasuryBefore)
  })

  it('peace dividends reduce siege pressure and food stress trends', () => {
    const world = generateWorld(9907)
    const [left, right] = Object.keys(world.kingdoms)
    const leftSettlement = Object.values(world.settlements).find((settlement) => settlement.kingdomId === left)
    const rightSettlement = Object.values(world.settlements).find((settlement) => settlement.kingdomId === right)
    expect(leftSettlement).toBeDefined()
    expect(rightSettlement).toBeDefined()
    if (!leftSettlement || !rightSettlement) return
    world.turn = 12
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendIntensity = 35
    world.kingdoms[right].policy.peaceDividendIntensity = 35
    setRelation(world, left, right, 12)
    leftSettlement.meta.siegePressure = 25
    rightSettlement.meta.siegePressure = 24
    leftSettlement.meta.foodStress = 30
    rightSettlement.meta.foodStress = 28
    const siegeBefore = leftSettlement.meta.siegePressure + rightSettlement.meta.siegePressure
    const stressBefore = leftSettlement.meta.foodStress + rightSettlement.meta.foodStress

    simulateDiplomacyTurn(world, new SeededRng(55))
    const siegeAfter = leftSettlement.meta.siegePressure + rightSettlement.meta.siegePressure
    const stressAfter = leftSettlement.meta.foodStress + rightSettlement.meta.foodStress
    expect(siegeAfter).toBeLessThan(siegeBefore)
    expect(stressAfter).toBeLessThan(stressBefore)
  })

  it('war resumption degrades active peace-corridor intensity', () => {
    const world = generateWorld(9912)
    const [left, right] = Object.keys(world.kingdoms)
    world.turn = 12
    setRelation(world, left, right, -20)
    setWarState(world, left, right, true)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 14
    world.kingdoms[left].policy.peaceDividendIntensity = 24
    world.kingdoms[right].policy.peaceDividendIntensity = 24

    const messages = simulateDiplomacyTurn(world, new SeededRng(71))
    expect(world.kingdoms[left].policy.peaceDividendIntensity).toBeLessThan(24)
    expect(world.kingdoms[right].policy.peaceDividendIntensity).toBeLessThan(24)
    expect(messages.some((line) => line.includes('fraying'))).toBe(true)
  })

  it('severe renewed conflict can collapse a fragile corridor entirely', () => {
    const world = generateWorld(9913)
    const [left, right] = Object.keys(world.kingdoms)
    world.turn = 12
    setRelation(world, left, right, -35)
    setWarState(world, left, right, true)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendIntensity = 6
    world.kingdoms[right].policy.peaceDividendIntensity = 6

    const messages = simulateDiplomacyTurn(world, new SeededRng(72))
    expect(world.kingdoms[left].policy.peaceDividendIntensity).toBe(0)
    expect(world.kingdoms[right].policy.peaceDividendIntensity).toBe(0)
    expect(world.kingdoms[left].policy.peaceDividendPartnerKingdomId).toBe('none')
    expect(world.kingdoms[right].policy.peaceDividendPartnerKingdomId).toBe('none')
    expect(messages.some((line) => line.includes('lost their peace corridor'))).toBe(true)
  })
})

