import { describe, expect, it } from 'vitest'
import { campaignRankInfo } from './campaignRank'

describe('campaign rank mapping', () => {
  it('maps reputation to stable campaign rank titles', () => {
    expect(campaignRankInfo(0).title).toBe('Unknown Drifter')
    expect(campaignRankInfo(12).title).toBe('Recognized Adventurer')
    expect(campaignRankInfo(28).title).toBe('Civic Champion')
    expect(campaignRankInfo(45).title).toBe('Royal Agent')
    expect(campaignRankInfo(70).title).toBe('Crown Marshal')
  })
})

