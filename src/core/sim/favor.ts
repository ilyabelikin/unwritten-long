export const favorRankTitle = (favor: number): string => {
  if (favor >= 75) return 'Royal Champion'
  if (favor >= 55) return 'High Envoy'
  if (favor >= 35) return 'Trusted Ally'
  if (favor >= 18) return 'Known Supporter'
  if (favor >= 8) return 'Recognized'
  return 'Outsider'
}

