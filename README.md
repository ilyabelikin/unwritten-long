# Frontier Realms (Turn-Based Living World Prototype)

A browser-based turn-based hex adventure simulation with:

- Procedurally generated layered world (continents/islands, elevation, vegetation, resources).
- Named settlements with kingdoms, population, buildings, stockpiles, roads, dreams, and treasury.
- Distinct character entities (HP/AP/age/skills/history/traits/flaws).
- Dynamic economy (needs, supply/demand pricing, caravan trade).
- Seasonal simulation (60 turns per season) affecting production and wildlife behavior.
- On-map combat and interactions (attack wildlife, rob caravans, guard retaliation on low reputation).
- Wildlife, bandits, migrants, and monsters roaming the world.

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

## Rules implemented

- Base AP = 4 per character.
- Road movement = 1 AP.
- Elevation climb increases AP cost.
- Rough/deep forest/mountain movement is more expensive.
- City guards become aggressive toward low-reputation players.
- HP ≤ 0 resolves to death/survival rules; city visit restores HP to full.
- Bears mostly hibernate in winter, with rare aggressive wake-ups.

## Tests

```bash
npm run test
npm run build
```

Tests include:
- world generation invariants,
- economy behavior and dynamic pricing response,
- turn progression and long-run stability checks.
