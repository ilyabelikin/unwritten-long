export interface CampaignRankInfo {
  tier: number
  title: string
  minReputation: number
}

const RANK_TABLE: CampaignRankInfo[] = [
  { tier: 0, title: 'Unknown Drifter', minReputation: -999 },
  { tier: 1, title: 'Recognized Adventurer', minReputation: 10 },
  { tier: 2, title: 'Civic Champion', minReputation: 24 },
  { tier: 3, title: 'Royal Agent', minReputation: 40 },
  { tier: 4, title: 'Crown Marshal', minReputation: 58 },
]

export const campaignRankInfo = (reputation: number): CampaignRankInfo => {
  for (let idx = RANK_TABLE.length - 1; idx >= 0; idx -= 1) {
    if (reputation >= RANK_TABLE[idx].minReputation) return RANK_TABLE[idx]
  }
  return RANK_TABLE[0]
}

export const campaignRankTitleForReputation = (reputation: number): string =>
  campaignRankInfo(reputation).title

