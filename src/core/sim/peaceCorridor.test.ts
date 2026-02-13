import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { setRelation, setWarState } from './diplomacy'
import {
  activePeaceCorridorForKingdom,
  routeRiskReliefFromPeaceCorridor,
  tariffReliefFromPeaceCorridor,
} from './peaceCorridor'

describe('peace corridor helpers', () => {
  it('requires bilateral partner linkage and active duration', () => {
    const world = generateWorld(9950)
    const [left, right] = Object.keys(world.kingdoms)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendIntensity = 22
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = 'none'
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendIntensity = 22
    setRelation(world, left, right, 12)
    setWarState(world, left, right, false)

    expect(activePeaceCorridorForKingdom(world, left)).toBeUndefined()
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    expect(activePeaceCorridorForKingdom(world, left)?.partnerKingdomId).toBe(right)
  })

  it('does not activate while at war or deeply hostile', () => {
    const world = generateWorld(9951)
    const [left, right] = Object.keys(world.kingdoms)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[left].policy.peaceDividendIntensity = 26
    world.kingdoms[right].policy.peaceDividendIntensity = 26
    setRelation(world, left, right, 10)
    setWarState(world, left, right, true)
    expect(activePeaceCorridorForKingdom(world, left)).toBeUndefined()

    setWarState(world, left, right, false)
    setRelation(world, left, right, -20)
    expect(activePeaceCorridorForKingdom(world, left)).toBeUndefined()
  })

  it('provides tariff and risk relief by intensity bands', () => {
    const world = generateWorld(9952)
    const [left, right] = Object.keys(world.kingdoms)
    world.kingdoms[left].policy.peaceDividendPartnerKingdomId = right
    world.kingdoms[right].policy.peaceDividendPartnerKingdomId = left
    world.kingdoms[left].policy.peaceDividendUntilTurn = world.turn + 10
    world.kingdoms[right].policy.peaceDividendUntilTurn = world.turn + 10
    setWarState(world, left, right, false)
    setRelation(world, left, right, 18)

    world.kingdoms[left].policy.peaceDividendIntensity = 22
    world.kingdoms[right].policy.peaceDividendIntensity = 22
    expect(tariffReliefFromPeaceCorridor(world, left, right)).toBe(0.04)
    expect(routeRiskReliefFromPeaceCorridor(world, left, right)).toBe(0.18)

    world.kingdoms[left].policy.peaceDividendIntensity = 38
    world.kingdoms[right].policy.peaceDividendIntensity = 38
    expect(tariffReliefFromPeaceCorridor(world, left, right)).toBe(0.08)
    expect(routeRiskReliefFromPeaceCorridor(world, left, right)).toBe(0.32)
  })
})
