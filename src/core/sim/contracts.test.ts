import { describe, expect, it } from 'vitest'
import type { Contract } from '../types'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { kingdomExclusivePool, seedInitialContracts, simulateContractBoardTurn } from './contracts'
import { isAtWar, relationBetween, setRelation, setWarState } from './diplomacy'
import { playerAcceptContract, playerProgressContract } from './turn'

describe('contracts system', () => {
  it('allows player to accept and complete a food delivery contract', () => {
    const world = generateWorld(9410)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-food-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'deliver_food',
      level: 1,
      status: 'available',
      good: 'grain',
      requiredAmount: 5,
      progress: 0,
      rewardReputation: 5,
      rewardBountyReduction: 4,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.inventory.grain = 6
    const repBefore = player.reputation

    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted contract')
    expect(world.contracts[contractId].status).toBe('active')

    const progressed = playerProgressContract(world)
    expect(progressed[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
    expect(player.reputation).toBeGreaterThan(repBefore)
    expect((player.inventory.grain ?? 0)).toBeLessThan(6)
  })

  it('updates hunt contracts from player bandit kills', () => {
    const world = generateWorld(9411)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-hunt-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'hunt_bandits',
      level: 1,
      status: 'available',
      requiredAmount: 1,
      progress: 0,
      rewardReputation: 7,
      rewardBountyReduction: 6,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.meta.banditsDefeated = 0
    playerAcceptContract(world, contractId)
    player.meta.banditsDefeated = 1
    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })

  it('seeds and rotates contracts over time', () => {
    const world = generateWorld(9412)
    world.contracts = {}
    seedInitialContracts(world, new SeededRng(8))
    const initialCount = Object.keys(world.contracts).length
    expect(initialCount).toBeGreaterThan(0)

    world.turn = 12
    const messages = simulateContractBoardTurn(world, new SeededRng(9))
    expect(Object.keys(world.contracts).length).toBeGreaterThanOrEqual(initialCount)
    expect(messages.length).toBeGreaterThanOrEqual(0)
  })

  it('can complete defend-settlement contracts via hostile kill progress', () => {
    const world = generateWorld(9413)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]

    const contractId = `test-defend-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'defend_settlement',
      level: 2,
      status: 'available',
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 6,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.meta.hostilesDefeated = 0
    playerAcceptContract(world, contractId)
    player.meta.hostilesDefeated = 2
    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })

  it('can complete escort-caravan contracts after meeting and delivery', () => {
    const world = generateWorld(9414)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const destination = Object.values(world.settlements).find((candidate) => candidate.id !== settlementId)
    expect(destination).toBeDefined()
    if (!destination) return

    const contractId = `test-escort-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'escort_caravan',
      level: 2,
      status: 'available',
      requiredAmount: 8,
      progress: 0,
      rewardReputation: 9,
      rewardBountyReduction: 8,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 20,
      meta: { destinationSettlementId: destination.id },
    }

    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted contract')
    const caravanId = world.contracts[contractId].meta.caravanId as string
    expect(caravanId).toBeDefined()
    world.contracts[contractId].meta.playerMetCaravan = true
    world.contracts[contractId].meta.caravanDelivered = true
    if (world.characters[caravanId]) {
      world.characters[caravanId].alive = false
    }

    const result = playerProgressContract(world)
    expect(result[0]).toContain('completed')
    expect(world.contracts[contractId].status).toBe('completed')
  })

  it('increases kingdom campaign progress on contract completion', () => {
    const world = generateWorld(9415)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const kingdomId = settlement.kingdomId
    const before = world.campaignProgress[kingdomId] ?? 0
    const contractId = `campaign-food-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'deliver_food',
      level: 1,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 4,
      rewardBountyReduction: 3,
      rewardGoods: {},
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.inventory.grain = 5
    playerAcceptContract(world, contractId)
    playerProgressContract(world)
    expect(world.campaignProgress[kingdomId]).toBeGreaterThan(before)
  })

  it('issues royal campaign contracts at high campaign progress', () => {
    const world = generateWorld(9416)
    const kingdomId = Object.keys(world.kingdoms).find(
      (id) => Object.values(world.settlements).filter((settlement) => settlement.kingdomId === id).length >= 2,
    )
    expect(kingdomId).toBeDefined()
    if (!kingdomId) return
    world.campaignProgress[kingdomId] = 6
    world.turn = 10
    const messages = simulateContractBoardTurn(world, new SeededRng(16))
    const royal = Object.values(world.contracts).find(
      (contract) => contract.issuerKingdomId === kingdomId && Boolean(contract.meta.campaign),
    )
    expect(royal).toBeDefined()
    expect(messages.some((line) => line.includes('campaign chain'))).toBe(true)
  })

  it('creates multi-stage campaign chains with locked follow-up stages', () => {
    const world = generateWorld(9418)
    const kingdomId = Object.keys(world.kingdoms).find(
      (id) => Object.values(world.settlements).filter((settlement) => settlement.kingdomId === id).length >= 2,
    )
    expect(kingdomId).toBeDefined()
    if (!kingdomId) return
    const otherKingdom = Object.keys(world.kingdoms).find((id) => id !== kingdomId)
    expect(otherKingdom).toBeDefined()
    if (!otherKingdom) return
    world.campaignProgress[kingdomId] = 8
    world.kingdomConflicts[[kingdomId, otherKingdom].sort().join('|')] = true
    world.turn = 10
    simulateContractBoardTurn(world, new SeededRng(17))
    const chainContracts = Object.values(world.contracts).filter(
      (contract) => contract.issuerKingdomId === kingdomId && Boolean(contract.meta.campaignChainId),
    )
    expect(chainContracts.length).toBeGreaterThanOrEqual(3)
    const stage1 = chainContracts.find((contract) => Number(contract.meta.campaignStage) === 1)
    const stage2 = chainContracts.find((contract) => Number(contract.meta.campaignStage) === 2)
    expect(stage1).toBeDefined()
    expect(stage2).toBeDefined()
    expect(stage1?.meta.locked).not.toBe(true)
    expect(stage2?.meta.locked).toBe(true)
  })

  it('unlocks next campaign stage after stage completion', () => {
    const world = generateWorld(9419)
    const player = world.characters[world.playerId]
    const kingdomId = Object.keys(world.kingdoms).find(
      (id) => Object.values(world.settlements).filter((settlement) => settlement.kingdomId === id).length >= 2,
    )
    expect(kingdomId).toBeDefined()
    if (!kingdomId) return
    const otherKingdom = Object.keys(world.kingdoms).find((id) => id !== kingdomId)
    expect(otherKingdom).toBeDefined()
    if (!otherKingdom) return
    world.campaignProgress[kingdomId] = 8
    world.kingdomConflicts[[kingdomId, otherKingdom].sort().join('|')] = true
    world.turn = 10
    simulateContractBoardTurn(world, new SeededRng(18))

    const stage1 = Object.values(world.contracts).find(
      (contract) =>
        contract.issuerKingdomId === kingdomId &&
        Number(contract.meta.campaignStage) === 1 &&
        contract.kind === 'defend_settlement',
    )
    const stage2 = Object.values(world.contracts).find(
      (contract) =>
        contract.issuerKingdomId === kingdomId &&
        Number(contract.meta.campaignStage) === 2 &&
        Boolean(contract.meta.campaignChainId),
    )
    expect(stage1).toBeDefined()
    expect(stage2).toBeDefined()
    if (!stage1 || !stage2) return

    const settlement = world.settlements[stage1.settlementId]
    player.location = settlement.tiles[0]
    player.reputation = 60
    const lockedAttempt = playerAcceptContract(world, stage2.id)
    expect(lockedAttempt[0]).toContain('locked')

    playerAcceptContract(world, stage1.id)
    player.meta.hostilesDefeated = Number(player.meta.hostilesDefeated ?? 0) + stage1.requiredAmount
    const completion = playerProgressContract(world)
    expect(completion.some((line) => line.includes('unlocked'))).toBe(true)
    expect(stage2.meta.locked).not.toBe(true)
  })

  it('expires remaining campaign chain stages when one stage times out', () => {
    const world = generateWorld(9420)
    const kingdomId = Object.keys(world.kingdoms).find(
      (id) => Object.values(world.settlements).filter((settlement) => settlement.kingdomId === id).length >= 2,
    )
    expect(kingdomId).toBeDefined()
    if (!kingdomId) return
    world.campaignProgress[kingdomId] = 8
    world.turn = 10
    simulateContractBoardTurn(world, new SeededRng(19))

    const chainContracts = Object.values(world.contracts)
      .filter((contract) => contract.issuerKingdomId === kingdomId && Boolean(contract.meta.campaignChainId))
      .sort((a, b) => Number(a.meta.campaignStage) - Number(b.meta.campaignStage))
    expect(chainContracts.length).toBeGreaterThanOrEqual(3)
    if (chainContracts.length < 3) return

    const stage1 = chainContracts[0]
    stage1.status = 'active'
    stage1.expiresTurn = world.turn
    world.turn += 2
    const messages = simulateContractBoardTurn(world, new SeededRng(20))
    expect(stage1.status).toBe('expired')
    expect(chainContracts[1].status).toBe('expired')
    expect(chainContracts[2].status).toBe('expired')
    expect(messages.some((line) => line.includes('campaign chain collapsed'))).toBe(true)
  })

  it('prefers defense contracts for settlements under siege pressure', () => {
    const base = generateWorld(9417)
    const settlement = Object.values(base.settlements).find((candidate) => candidate.tier !== 'hamlet')
    expect(settlement).toBeDefined()
    if (!settlement) return

    let foundDefense = false
    for (let seed = 1; seed <= 24 && !foundDefense; seed += 1) {
      const world = structuredClone(base)
      world.turn = 6
      world.contracts = {}
      const target = world.settlements[settlement.id]
      target.meta.siegePressure = 70
      target.meta.foodStress = 10
      simulateContractBoardTurn(world, new SeededRng(seed))
      foundDefense = Object.values(world.contracts).some(
        (contract) => contract.settlementId === settlement.id && contract.kind === 'defend_settlement',
      )
    }
    expect(foundDefense).toBe(true)
  })

  it('increases player kingdom favor after contract completion', () => {
    const world = generateWorld(9421)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const kingdomId = settlement.kingdomId
    const favorBefore = world.playerKingdomFavor[kingdomId]
    const contractId = `favor-food-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'deliver_food',
      level: 1,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 4,
      rewardBountyReduction: 3,
      rewardGoods: {},
      expiresTurn: world.turn + 20,
      meta: {},
    }
    player.inventory.grain = 6
    playerAcceptContract(world, contractId)
    playerProgressContract(world)
    expect(world.playerKingdomFavor[kingdomId]).toBeGreaterThan(favorBefore)
  })

  it('gates exclusive contracts by favor requirement', () => {
    const world = generateWorld(9422)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const kingdomId = settlement.kingdomId
    const contractId = `exclusive-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'defend_settlement',
      level: 3,
      status: 'available',
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 8,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 18,
      meta: {
        exclusive: true,
        minFavor: 12,
        exclusiveTitle: 'Noble Commission',
      },
    }

    world.playerKingdomFavor[kingdomId] = 5
    const denied = playerAcceptContract(world, contractId)
    expect(denied[0]).toContain('requires kingdom favor')
    expect(world.contracts[contractId].status).toBe('available')

    world.playerKingdomFavor[kingdomId] = 15
    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted')
    expect(world.contracts[contractId].status).toBe('active')
  })

  it('assigns deterministic exclusive pools across kingdoms', () => {
    const world = generateWorld(9423)
    const kingdomIds = Object.keys(world.kingdoms)
    expect(kingdomIds.length).toBeGreaterThan(1)
    const pools = kingdomIds.map((id) => kingdomExclusivePool(world, id))
    expect(pools.every((pool) => ['harvest', 'warden', 'guild'].includes(pool))).toBe(true)
    expect(new Set(pools).size).toBeGreaterThan(1)
  })

  it('uses kingdom pool metadata when spawning exclusive contracts', () => {
    const base = generateWorld(9424)
    const settlement = Object.values(base.settlements).find((candidate) => candidate.tier !== 'hamlet')
    expect(settlement).toBeDefined()
    if (!settlement) return
    const kingdomId = settlement.kingdomId
    const expectedPool = kingdomExclusivePool(base, kingdomId)
    let exclusive: Contract | undefined

    for (let seed = 1; seed <= 32 && !exclusive; seed += 1) {
      const world = structuredClone(base)
      world.contracts = {}
      world.playerKingdomFavor[kingdomId] = 30
      seedInitialContracts(world, new SeededRng(seed))
      exclusive = Object.values(world.contracts).find(
        (contract) => contract.settlementId === settlement.id && contract.meta.exclusive === true,
      )
    }

    expect(exclusive).toBeDefined()
    if (!exclusive) return
    expect(exclusive.meta.exclusivePool).toBe(expectedPool)
    expect(typeof exclusive.meta.exclusiveTitle).toBe('string')
    if (expectedPool === 'harvest') {
      expect(exclusive.kind).toBe('deliver_food')
    } else if (expectedPool === 'warden') {
      expect(['defend_settlement', 'hunt_bandits']).toContain(exclusive.kind)
    } else {
      expect(['escort_caravan', 'hunt_bandits']).toContain(exclusive.kind)
    }
  })

  it('gates contracts by minimum reputation requirement', () => {
    const world = generateWorld(9425)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const kingdomId = settlement.kingdomId
    const contractId = `rank-gated-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'defend_settlement',
      level: 3,
      status: 'available',
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 8,
      rewardGoods: { gold_ore: 1 },
      expiresTurn: world.turn + 18,
      meta: {
        minReputation: 32,
      },
    }

    player.reputation = 20
    const denied = playerAcceptContract(world, contractId)
    expect(denied[0]).toContain('requires reputation')
    expect(world.contracts[contractId].status).toBe('available')

    player.reputation = 34
    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted')
    expect(world.contracts[contractId].status).toBe('active')
  })

  it('assigns escalating reputation requirements to royal campaign stages', () => {
    const world = generateWorld(9426)
    const kingdomId = Object.keys(world.kingdoms).find(
      (id) => Object.values(world.settlements).filter((settlement) => settlement.kingdomId === id).length >= 2,
    )
    expect(kingdomId).toBeDefined()
    if (!kingdomId) return
    world.campaignProgress[kingdomId] = 8
    world.turn = 10
    simulateContractBoardTurn(world, new SeededRng(26))

    const stages = Object.values(world.contracts)
      .filter((contract) => contract.issuerKingdomId === kingdomId && Boolean(contract.meta.campaignChainId))
      .sort((a, b) => Number(a.meta.campaignStage) - Number(b.meta.campaignStage))
    expect(stages.length).toBeGreaterThanOrEqual(3)
    if (stages.length < 3) return
    const stageRep = stages.map((contract) => Number(contract.meta.minReputation ?? 0))
    expect(stageRep[0]).toBeGreaterThan(0)
    expect(stageRep[1]).toBeGreaterThan(stageRep[0])
    expect(stageRep[2]).toBeGreaterThan(stageRep[1])
  })

  it('tags generated contracts with court faction directives', () => {
    const world = generateWorld(9427)
    const settlement = Object.values(world.settlements).find((candidate) => candidate.tier !== 'hamlet')
    expect(settlement).toBeDefined()
    if (!settlement) return
    world.contracts = {}
    seedInitialContracts(world, new SeededRng(27))
    const contract = Object.values(world.contracts).find((entry) => entry.settlementId === settlement.id)
    expect(contract).toBeDefined()
    if (!contract) return
    expect(contract.meta.courtFaction).toBe(world.kingdoms[settlement.kingdomId].policy.courtFaction)
    expect(typeof contract.meta.courtDirective).toBe('string')
  })

  it('war hawk courts produce stronger security rewards than merchant courts', () => {
    const base = generateWorld(9428)
    const settlement = Object.values(base.settlements).find((candidate) => candidate.tier !== 'hamlet')
    expect(settlement).toBeDefined()
    if (!settlement) return

    let warHawkContract: Contract | undefined
    let merchantContract: Contract | undefined
    for (let seed = 1; seed <= 40; seed += 1) {
      const warWorld = structuredClone(base)
      const merchantWorld = structuredClone(base)
      const kingdomId = settlement.kingdomId
      warWorld.contracts = {}
      merchantWorld.contracts = {}
      warWorld.settlements[settlement.id].meta.siegePressure = 85
      merchantWorld.settlements[settlement.id].meta.siegePressure = 85
      warWorld.kingdoms[kingdomId].policy.courtFaction = 'war_hawks'
      merchantWorld.kingdoms[kingdomId].policy.courtFaction = 'merchant_bloc'
      seedInitialContracts(warWorld, new SeededRng(seed))
      seedInitialContracts(merchantWorld, new SeededRng(seed))
      warHawkContract = Object.values(warWorld.contracts).find((entry) => entry.settlementId === settlement.id)
      merchantContract = Object.values(merchantWorld.contracts).find((entry) => entry.settlementId === settlement.id)
      if (
        warHawkContract?.kind === 'defend_settlement' &&
        merchantContract?.kind === 'defend_settlement'
      ) {
        break
      }
    }

    expect(warHawkContract).toBeDefined()
    expect(merchantContract).toBeDefined()
    if (!warHawkContract || !merchantContract) return
    expect(warHawkContract.kind).toBe('defend_settlement')
    expect(merchantContract.kind).toBe('defend_settlement')
    expect(warHawkContract.rewardBountyReduction).toBeGreaterThan(merchantContract.rewardBountyReduction)
  })

  it('increases player court standing when court-directed contracts are completed', () => {
    const world = generateWorld(9429)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const contractId = `court-standing-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'deliver_food',
      level: 2,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 6,
      rewardBountyReduction: 3,
      rewardGoods: {},
      expiresTurn: world.turn + 20,
      meta: {
        courtFaction: 'reformers',
        courtDirective: 'Civic Reform Petition',
      },
    }
    const before = world.playerCourtFavor.reformers
    player.inventory.grain = 6
    playerAcceptContract(world, contractId)
    playerProgressContract(world)
    expect(world.playerCourtFavor.reformers).toBeGreaterThan(before)
  })

  it('rivalry contracts reduce rival faction standing on completion', () => {
    const world = generateWorld(9431)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const contractId = `rivalry-standing-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'deliver_food',
      level: 2,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 7,
      rewardBountyReduction: 4,
      rewardGoods: {},
      expiresTurn: world.turn + 20,
      meta: {
        courtFaction: 'merchant_bloc',
        rivalFaction: 'war_hawks',
        courtDirective: 'Merchant Bloc Counter-Mandate',
      },
    }
    world.playerCourtFavor.merchant_bloc = 10
    world.playerCourtFavor.war_hawks = 7
    player.inventory.grain = 6
    playerAcceptContract(world, contractId)
    playerProgressContract(world)
    expect(world.playerCourtFavor.merchant_bloc).toBeGreaterThan(10)
    expect(world.playerCourtFavor.war_hawks).toBeLessThan(7)
  })

  it('gates patronage contracts by faction standing requirement', () => {
    const world = generateWorld(9430)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const contractId = `patronage-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'defend_settlement',
      level: 3,
      status: 'available',
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 7,
      rewardGoods: { iron_ingot: 1 },
      expiresTurn: world.turn + 20,
      meta: {
        courtFaction: 'merchant_bloc',
        courtDirective: 'Commercial Charter',
        courtPatronage: true,
        courtPatronTitle: 'Guild Patronage',
        minCourtFavor: 12,
      },
    }

    world.playerCourtFavor.merchant_bloc = 5
    const denied = playerAcceptContract(world, contractId)
    expect(denied[0]).toContain('standing 12')
    expect(world.contracts[contractId].status).toBe('available')

    world.playerCourtFavor.merchant_bloc = 16
    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted')
    expect(world.contracts[contractId].status).toBe('active')
  })

  it('gates truce contracts by standing in both involved factions', () => {
    const world = generateWorld(9432)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const contractId = `truce-gate-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId: settlement.kingdomId,
      kind: 'deliver_food',
      level: 3,
      status: 'available',
      good: 'grain',
      requiredAmount: 8,
      progress: 0,
      rewardReputation: 11,
      rewardBountyReduction: 8,
      rewardGoods: { tools: 2 },
      expiresTurn: world.turn + 20,
      meta: {
        truceIncident: true,
        trucePair: 'merchant_bloc|reformers',
        courtFaction: 'merchant_bloc',
        rivalFaction: 'reformers',
        courtDirective: 'Merchant Bloc-Reformers Truce Summit',
        minCourtFavorByFaction: {
          merchant_bloc: 10,
          reformers: 10,
        },
      },
    }

    world.playerCourtFavor.merchant_bloc = 12
    world.playerCourtFavor.reformers = 6
    const denied = playerAcceptContract(world, contractId)
    expect(denied[0]).toContain('standing 10')
    expect(world.contracts[contractId].status).toBe('available')

    world.playerCourtFavor.reformers = 11
    const accepted = playerAcceptContract(world, contractId)
    expect(accepted[0]).toContain('accepted')
    expect(world.contracts[contractId].status).toBe('active')
  })

  it('unlocks and resolves summit chain mandates with lasting détente effects', () => {
    const world = generateWorld(9433)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const kingdomId = settlement.kingdomId
    const policy = world.kingdoms[kingdomId].policy
    policy.factionTension = 78
    policy.courtStability = 38
    policy.factionTrucePair = 'merchant_bloc|reformers'
    policy.factionTruceUntilTurn = world.turn + 12
    world.playerCourtFavor.merchant_bloc = 14
    world.playerCourtFavor.reformers = 12

    const stage1Id = `summit-stage1-${world.turn}`
    const stage2Id = `summit-stage2-${world.turn}`
    world.contracts[stage1Id] = {
      id: stage1Id,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'deliver_food',
      level: 2,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 5,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {
        truceIncident: true,
        trucePair: 'merchant_bloc|reformers',
        summitChainId: 'summit-test-chain',
        summitStage: 1,
        summitTotalStages: 2,
        locked: false,
        courtFaction: 'merchant_bloc',
        rivalFaction: 'reformers',
        minCourtFavorByFaction: { merchant_bloc: 10, reformers: 10 },
      },
    }
    world.contracts[stage2Id] = {
      id: stage2Id,
      settlementId,
      issuerKingdomId: kingdomId,
      kind: 'deliver_food',
      level: 3,
      status: 'available',
      good: 'grain',
      requiredAmount: 5,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 7,
      rewardGoods: { iron_ingot: 1 },
      expiresTurn: world.turn + 22,
      meta: {
        truceIncident: true,
        trucePair: 'merchant_bloc|reformers',
        summitChainId: 'summit-test-chain',
        summitStage: 2,
        summitTotalStages: 2,
        locked: true,
        courtFaction: 'merchant_bloc',
        rivalFaction: 'reformers',
        minCourtFavorByFaction: { merchant_bloc: 11, reformers: 11 },
      },
    }

    const locked = playerAcceptContract(world, stage2Id)
    expect(locked[0]).toContain('locked')

    player.inventory.grain = 12
    const beforeTension = policy.factionTension
    const beforeStability = policy.courtStability
    const beforeMerchant = world.playerCourtFavor.merchant_bloc
    const beforeReformers = world.playerCourtFavor.reformers

    playerAcceptContract(world, stage1Id)
    const stage1Done = playerProgressContract(world)
    expect(stage1Done.some((line) => line.includes('Summit mandate stage 1 complete'))).toBe(true)
    expect(world.contracts[stage2Id].meta.locked).not.toBe(true)

    playerAcceptContract(world, stage2Id)
    const stage2Done = playerProgressContract(world)
    expect(stage2Done.some((line) => line.includes('Truce summit chain completed'))).toBe(true)
    expect(policy.factionTension).toBeLessThan(beforeTension)
    expect(policy.courtStability).toBeGreaterThan(beforeStability)
    expect(policy.factionTrucePair).toBe('none')
    expect(world.playerCourtFavor.merchant_bloc).toBeGreaterThan(beforeMerchant)
    expect(world.playerCourtFavor.reformers).toBeGreaterThan(beforeReformers)
  })

  it('can post diplomatic summit chains for tense kingdom pairs', () => {
    const base = generateWorld(9434)
    const pair = Object.keys(base.kingdomRelations)[0]
    expect(pair).toBeDefined()
    if (!pair) return
    const [left, right] = pair.split('|')
    setRelation(base, left, right, -32)
    base.turn = 12
    let found = false

    for (let seed = 1; seed <= 30 && !found; seed += 1) {
      const world = structuredClone(base)
      const messages = simulateContractBoardTurn(world, new SeededRng(seed))
      const summitContracts = Object.values(world.contracts)
        .filter((contract) => contract.meta.diplomaticSummit === true && contract.meta.diplomaticPairKey === pair)
        .sort((a, b) => Number(a.meta.diplomaticStage ?? 0) - Number(b.meta.diplomaticStage ?? 0))
      if (summitContracts.length >= 2) {
        found = true
        expect(messages.some((line) => line.includes('diplomatic summit chain'))).toBe(true)
        expect(summitContracts[0].meta.locked).not.toBe(true)
        expect(summitContracts[1].meta.locked).toBe(true)
      }
    }

    expect(found).toBe(true)
  })

  it('diplomatic summit chain completion improves relations and can end war', () => {
    const world = generateWorld(9435)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const issuerKingdomId = settlement.kingdomId
    const partnerKingdomId = Object.keys(world.kingdoms).find((id) => id !== issuerKingdomId)
    expect(partnerKingdomId).toBeDefined()
    if (!partnerKingdomId) return
    setRelation(world, issuerKingdomId, partnerKingdomId, -8)
    setWarState(world, issuerKingdomId, partnerKingdomId, true)
    const relationBefore = relationBetween(world, issuerKingdomId, partnerKingdomId)

    const stage1Id = `dip-stage1-${world.turn}`
    const stage2Id = `dip-stage2-${world.turn}`
    world.contracts[stage1Id] = {
      id: stage1Id,
      settlementId,
      issuerKingdomId,
      kind: 'deliver_food',
      level: 2,
      status: 'available',
      good: 'grain',
      requiredAmount: 4,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 5,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn + 20,
      meta: {
        diplomaticSummit: true,
        diplomaticSummitChainId: 'dip-chain',
        diplomaticStage: 1,
        diplomaticTotalStages: 2,
        diplomaticPartnerKingdomId: partnerKingdomId,
        diplomaticPairKey: [issuerKingdomId, partnerKingdomId].sort().join('|'),
        locked: false,
      },
    }
    world.contracts[stage2Id] = {
      id: stage2Id,
      settlementId,
      issuerKingdomId,
      kind: 'deliver_food',
      level: 3,
      status: 'available',
      good: 'grain',
      requiredAmount: 5,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 7,
      rewardGoods: { iron_ingot: 1 },
      expiresTurn: world.turn + 22,
      meta: {
        diplomaticSummit: true,
        diplomaticSummitChainId: 'dip-chain',
        diplomaticStage: 2,
        diplomaticTotalStages: 2,
        diplomaticPartnerKingdomId: partnerKingdomId,
        diplomaticPairKey: [issuerKingdomId, partnerKingdomId].sort().join('|'),
        locked: true,
      },
    }

    const blocked = playerAcceptContract(world, stage2Id)
    expect(blocked[0]).toContain('locked')
    player.inventory.grain = 12
    playerAcceptContract(world, stage1Id)
    const stage1Done = playerProgressContract(world)
    expect(stage1Done.some((line) => line.includes('Diplomatic summit stage 1 complete'))).toBe(true)
    expect(world.contracts[stage2Id].meta.locked).not.toBe(true)

    playerAcceptContract(world, stage2Id)
    const stage2Done = playerProgressContract(world)
    expect(stage2Done.some((line) => line.includes('Diplomatic summit chain completed'))).toBe(true)
    const relationAfter = relationBetween(world, issuerKingdomId, partnerKingdomId)
    expect(relationAfter).toBeGreaterThan(relationBefore)
    expect(isAtWar(world, issuerKingdomId, partnerKingdomId)).toBe(false)
    const issuerPolicy = world.kingdoms[issuerKingdomId].policy
    const partnerPolicy = world.kingdoms[partnerKingdomId].policy
    expect(issuerPolicy.peaceDividendUntilTurn).toBeGreaterThan(world.turn)
    expect(partnerPolicy.peaceDividendUntilTurn).toBeGreaterThan(world.turn)
    expect(issuerPolicy.peaceDividendPartnerKingdomId).toBe(partnerKingdomId)
    expect(partnerPolicy.peaceDividendPartnerKingdomId).toBe(issuerKingdomId)
    expect(issuerPolicy.peaceDividendIntensity).toBeGreaterThan(0)
    expect(partnerPolicy.peaceDividendIntensity).toBeGreaterThan(0)
  })

  it('can spawn peace-opposition mandates during active diplomatic summit chains', () => {
    const base = generateWorld(9436)
    const settlement = Object.values(base.settlements)[0]
    const issuerKingdomId = settlement.kingdomId
    const partnerKingdomId = Object.keys(base.kingdoms).find((id) => id !== issuerKingdomId)
    expect(partnerKingdomId).toBeDefined()
    if (!partnerKingdomId) return
    base.kingdoms[issuerKingdomId].policy.courtFaction = 'war_hawks'
    base.kingdoms[partnerKingdomId].policy.courtFaction = 'war_hawks'
    const pairKey = [issuerKingdomId, partnerKingdomId].sort().join('|')

    let found = false
    for (let seed = 1; seed <= 32 && !found; seed += 1) {
      const world = structuredClone(base)
      world.turn = 9
      world.contracts = {}
      const stageId = `dip-open-${seed}`
      world.contracts[stageId] = {
        id: stageId,
        settlementId: settlement.id,
        issuerKingdomId,
        kind: 'defend_settlement',
        level: 3,
        status: 'available',
        requiredAmount: 2,
        progress: 0,
        rewardReputation: 9,
        rewardBountyReduction: 7,
        rewardGoods: { tools: 1 },
        expiresTurn: world.turn + 20,
        meta: {
          diplomaticSummit: true,
          diplomaticSummitChainId: 'dip-open-chain',
          diplomaticStage: 1,
          diplomaticTotalStages: 2,
          diplomaticPartnerKingdomId: partnerKingdomId,
          diplomaticPairKey: pairKey,
          locked: false,
        },
      }

      const messages = simulateContractBoardTurn(world, new SeededRng(seed))
      const opposition = Object.values(world.contracts).find(
        (contract) =>
          contract.meta.diplomaticOpposition === true &&
          contract.meta.linkedDiplomaticSummitChainId === 'dip-open-chain',
      )
      if (opposition) {
        found = true
        expect(messages.some((line) => line.includes('Counter-mandates') || line.includes('public pressure'))).toBe(true)
      }
    }

    expect(found).toBe(true)
  })

  it('completing opposition mandates can improve relations and end wars', () => {
    const world = generateWorld(9437)
    const player = world.characters[world.playerId]
    const settlementId = world.tiles[player.location].settlementId
    expect(settlementId).toBeDefined()
    if (!settlementId) return
    const settlement = world.settlements[settlementId]
    const issuerKingdomId = settlement.kingdomId
    const partnerKingdomId = Object.keys(world.kingdoms).find((id) => id !== issuerKingdomId)
    expect(partnerKingdomId).toBeDefined()
    if (!partnerKingdomId) return
    setRelation(world, issuerKingdomId, partnerKingdomId, -6)
    setWarState(world, issuerKingdomId, partnerKingdomId, true)
    const relationBefore = relationBetween(world, issuerKingdomId, partnerKingdomId)
    const contractId = `opp-complete-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId,
      issuerKingdomId,
      kind: 'deliver_food',
      level: 3,
      status: 'available',
      good: 'grain',
      requiredAmount: 5,
      progress: 0,
      rewardReputation: 10,
      rewardBountyReduction: 7,
      rewardGoods: { tools: 2 },
      expiresTurn: world.turn + 20,
      meta: {
        diplomaticSummit: true,
        diplomaticOpposition: true,
        oppositionType: 'war_hawk_sabotage',
        linkedDiplomaticSummitChainId: 'dip-opp-chain',
        diplomaticPartnerKingdomId: partnerKingdomId,
        diplomaticPairKey: [issuerKingdomId, partnerKingdomId].sort().join('|'),
      },
    }
    player.inventory.grain = 8
    playerAcceptContract(world, contractId)
    playerProgressContract(world)
    const relationAfter = relationBetween(world, issuerKingdomId, partnerKingdomId)
    expect(relationAfter).toBeGreaterThan(relationBefore)
    expect(isAtWar(world, issuerKingdomId, partnerKingdomId)).toBe(false)
  })

  it('failing active opposition mandates worsens summit relations', () => {
    const world = generateWorld(9438)
    const settlement = Object.values(world.settlements)[0]
    const issuerKingdomId = settlement.kingdomId
    const partnerKingdomId = Object.keys(world.kingdoms).find((id) => id !== issuerKingdomId)
    expect(partnerKingdomId).toBeDefined()
    if (!partnerKingdomId) return
    setRelation(world, issuerKingdomId, partnerKingdomId, -14)
    const before = relationBetween(world, issuerKingdomId, partnerKingdomId)
    const contractId = `opp-expire-${world.turn}`
    world.contracts[contractId] = {
      id: contractId,
      settlementId: settlement.id,
      issuerKingdomId,
      kind: 'hunt_bandits',
      level: 2,
      status: 'active',
      assignedCharacterId: world.playerId,
      requiredAmount: 2,
      progress: 0,
      rewardReputation: 8,
      rewardBountyReduction: 6,
      rewardGoods: { tools: 1 },
      expiresTurn: world.turn,
      meta: {
        diplomaticSummit: true,
        diplomaticOpposition: true,
        oppositionType: 'reformer_counterpressure',
        linkedDiplomaticSummitChainId: 'dip-opp-expire-chain',
        diplomaticPartnerKingdomId: partnerKingdomId,
      },
    }
    world.turn += 2
    simulateContractBoardTurn(world, new SeededRng(38))
    const after = relationBetween(world, issuerKingdomId, partnerKingdomId)
    expect(after).toBeLessThan(before)
  })
})

