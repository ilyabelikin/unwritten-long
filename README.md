# Frontier Realms (Turn-Based Living World Prototype)

A browser-based turn-based hex adventure simulation with:

- Procedurally generated layered world (continents/islands, elevation, vegetation, resources).
- Named settlements with kingdoms, population, buildings, stockpiles, roads, dreams, and treasury.
- Distinct character entities (HP/AP/age/skills/history/traits/flaws).
- Dynamic economy (needs, supply/demand pricing, caravan trade).
- Seasonal simulation (60 turns per season) affecting production and wildlife behavior.
- On-map combat and interactions (attack wildlife, rob caravans, guard retaliation on low reputation / high bounty).
- Wildlife, bandits, migrants, and monsters roaming the world.
- Local save/load support with world-state persistence.
- Kingdom diplomacy with dynamic relations, conflicts, policy shifts, and tariff-aware trade risk.
- Diplomatic incident chain (trade charters, border crises, armistice pressure) affecting treasury and tensions.
- Settlement contract board system (food deliveries and bandit hunts) with player acceptance/progression.
- Multi-stage contract tiers including caravan escort and settlement defense objectives.
- Kingdom campaign progression: completed contracts raise campaign standing and unlock high-priority royal objectives.
- Siege pressure simulation for towns/cities under nearby hostile presence, influencing economy and defense urgency.
- Royal campaign chains run in staged objectives; missing critical stages can collapse the full chain.
- Kingdom favor/rank progression unlocks exclusive local commissions with higher requirements and rewards.
- Each kingdom now issues its own exclusive commission pool (Harvest Court, Warden Hall, Guild Ledger styles).
- Reputation now grants campaign rank titles; royal/exclusive contracts can require minimum rank.
- Kingdom-specific legal systems now vary guard hostility thresholds, bounty decay speed, and pardon pricing.
- Justice event chain added: kingdoms can trigger manhunts, amnesty decrees, and corruption crackdowns.
- Court politics layer added: noble influence and court stability can trigger coups and emergency edicts.
- Court factions (Merchant Bloc, War Hawks, Reformers) now compete to steer kingdom edicts and priorities.
- Contracts now carry court directives from the ruling faction and adjust rewards/objectives accordingly.
- Player now has separate court standing tracks (Merchant Bloc / War Hawks / Reformers).

## Tech

- TypeScript
- React (HUD + UI)
- SVG hex renderer (pixel-art style assets stored separately under `public/assets`)
- Zustand (state management)
- Vitest (simulation tests)

## Run

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

## Controls

- **Click adjacent hex**: move player (AP cost based on roads/elevation/terrain).
- **Click entity on same tile**:
  - Wildlife / hostile actors: attack.
  - Caravan: robbery prompt (if your reputation is still positive).
- **AP reaches 0**: world turn auto-advances.
- **End Turn** button: spend remaining AP and advance immediately.
- **New World** button: regenerate with a fresh seed.
- **Save / Load** buttons: persist and restore game state from browser local storage.
- **Overlay selector**: switch map intel between terrain, kingdoms, economy, and danger.
- **Civic actions in settlements**: donate supplies, sponsor diplomatic talks, and request city pardons.
- **Contract board in settlements**: accept local contracts and report progress for rewards.
- **Royal campaign contracts** may appear in capitals after sustained kingdom service.
- **Siege pressure** is visible in settlement stats and increases demand for defensive contracts.
- **Kingdom favor ranks** are shown in diplomacy intel and gate special contract offers.
- **Exclusive commissions** reflect the issuer kingdom's contract pool theme and rewards.
- **Campaign rank titles** are based on reputation and can gate high-trust contracts.
- **Legal policy values** are visible per kingdom (guard hostility, bounty decay, pardon factor).
- **Justice alerts** can temporarily change local law pressure (manhunts/amnesty/crackdowns).
- **Court edicts** (Martial Law, Tax Relief, Trade Fair) are shown per kingdom with expiry turns.
- **Court factions/tension** are visible per kingdom and can trigger influence shifts over time.
- **Contract cards** now display issuing court directive/faction flavor where applicable.
- **Patronage contracts** can require minimum court standing in addition to favor/reputation.
- **Militia action**: spend tools to raise temporary local guards during dangerous periods.

## Rules implemented

- Base AP = 4 per character.
- Road movement = 1 AP.
- Elevation climb increases AP cost.
- Rough/deep forest/mountain movement is more expensive.
- City guards become aggressive toward low-reputation players.
- Criminal actions build bounty; guards escalate pursuit for wanted players.
- Each kingdom enforces different legal thresholds (some crack down quickly, others are lenient).
- During severe bounty spikes, kingdoms may dispatch temporary marshals under active manhunts.
- Court coups can impose martial law, while stable courts may issue relief/trade edicts that reshape policy effects.
- Faction dominance now shapes which edicts are likely (war hawk crackdowns, merchant trade fairs, reform relief).
- Faction-backed contracts now bias incentives (security bounties, commerce goods, or civic aid rewards).
- Completing court-directed contracts increases standing with that faction; failed active contracts can reduce it.
- HP ≤ 0 resolves to death/survival rules; city visit restores HP to full.
- Bears mostly hibernate in winter, with rare aggressive wake-ups.
- Seasonal crop cycle and food stress drive migration/growth/decline pressure in settlements.
- Wildlife ecology includes predator-prey interactions and seasonal births/attrition.
- Kingdom conflicts can trigger frontier clashes; policies (tax/patrol/trade stance) evolve over time.
- War borders influence danger overlays and can spawn armed warbands.
- War refugees can emerge from conflict frontiers and migrate toward safer, prosperous regions.

## Tests

```bash
npm run test
npm run build
```

Tests include:
- world generation invariants,
- economy behavior and dynamic pricing response,
- combat and loot outcomes,
- persistence round-trip/migration checks,
- turn progression and long-run stability checks.
