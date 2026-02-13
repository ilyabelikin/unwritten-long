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
- High court-faction tension can now generate rivalry incidents with faction counter-mandate contracts.
- Rival factions can now hold temporary truce summits, producing hybrid mandate contracts.
- Truce summits now appear as multi-stage mandate chains with locked follow-up objectives.
- Cross-kingdom diplomatic summit chains can appear for tense/war-torn pairs and stage ceasefire diplomacy.
- Peace opposition incidents can emerge around diplomatic summits (war hawk sabotage vs reformer counterpressure mandates).
- Successful diplomatic summit chains now grant temporary peace dividends that stimulate local economies.
- While active, peace dividends can trigger periodic trade-boom pulses that improve relations, frontier stability, and food pressure.

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
- **Overlay selector**: switch map intel between terrain, kingdoms, economy, danger, and corridor stability.
- **Civic actions in settlements**: donate supplies, sponsor diplomatic talks, and request city pardons.
- **Sponsored treaties** can now open provisional peace corridors that seed peace-dividend effects earlier.
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
- **Rivalry contracts** may target competing court factions and affect inter-faction standing on success/failure.
- **Truce summit contracts** can require standing in both participating factions and grant joint standing gains.
- **Diplomatic summit contracts** run as staged chains that improve inter-kingdom relations on completion.
- **Peace-opposition mandates** can raise or sink summit relations depending on completion/expiry outcomes.
- **Summit chain stages** unlock sequentially and can collapse if a critical stage expires.
- **Peace dividend status** is shown per kingdom (partner, intensity, and expiry turn).
- **Peace-dividend opportunities** can appear on contract boards as boom-time escort/supply commissions.
- **Boom-time contract outcomes** can reinforce or weaken active peace dividends depending on success/failure.
- Some peace-dividend escorts now form explicit cross-border trade corridors with partner kingdoms.
- Fraying corridors can post dedicated maintenance mandates to preserve détente logistics.
- Corridor mandates now record corridor-health context (`critical`/`fragile`/`stable`/`robust`) when posted.
- Losing a peace-corridor caravan can sharply damage or even collapse a fragile dividend détente.
- Corridor-active cities apply softer guard/legal pressure (more bounty decay and reduced pardon burden).
- Active corridors also reduce cross-border caravan tariffs and route risk, improving sustained inter-kingdom trade.
- Sustained corridors gradually nudge kingdom enforcement policy toward less protectionist, less punitive settings.
- Diplomacy panel pair rows now surface live corridor intensity/turns and health state for fast treaty risk scanning.
- Corridor trade/peace bonuses pause automatically if the paired kingdoms return to open war.
- If conflict reignites, corridor intensity now degrades and fragile corridors can fully collapse.
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
- Active peace corridors reduce manhunt pressure and increase chances of amnesty decrees in connected kingdoms.
- Court coups can impose martial law, while stable courts may issue relief/trade edicts that reshape policy effects.
- Faction dominance now shapes which edicts are likely (war hawk crackdowns, merchant trade fairs, reform relief).
- Faction-backed contracts now bias incentives (security bounties, commerce goods, or civic aid rewards).
- Completing court-directed contracts increases standing with that faction; failed active contracts can reduce it.
- Rivalry mandate outcomes can raise your aligned faction standing while eroding rival faction standing.
- Truce summit periods dampen faction tension spikes and can temporarily stabilize court politics.
- Completing a full summit chain grants a lasting détente effect (lower tension, higher court stability).
- Completing diplomatic summit chains can end wars once relations recover past ceasefire thresholds.
- Failing active peace-opposition responses can drag relations back down and destabilize summit momentum.
- Active peace dividends improve caravan viability, strengthen prosperity drift, reduce food stress pressure, and dampen raid/refugee spikes near recovering borders.
- Active peace dividends can also trigger refugee repatriation routes back into former conflict kingdoms.
- Strong peace-dividend corridors can demobilize frontier warbands into deserters or civilian migrants.
- Corridor-backed diplomacy incidents now favor trade charters and can de-escalate border crises through mediation.
- Bandit road raids are increasingly diverted away from strongly stabilized corridor routes.
- Demobilized deserters who resettle can modestly improve local stability and ease bilateral tension.
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
