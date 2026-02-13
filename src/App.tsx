import './App.css'
import { useGameStore } from './game/store'
import { MapView } from './ui/MapView'
import { Hud } from './ui/Hud'

const App = () => {
  const world = useGameStore((state) => state.world)
  const actionFeed = useGameStore((state) => state.actionFeed)
  const lastSavedAt = useGameStore((state) => state.lastSavedAt)
  const mapOverlay = useGameStore((state) => state.mapOverlay)
  const regenerate = useGameStore((state) => state.regenerate)
  const clickTile = useGameStore((state) => state.clickTile)
  const clickCharacter = useGameStore((state) => state.clickCharacter)
  const endTurn = useGameStore((state) => state.forceEndTurn)
  const setMapOverlay = useGameStore((state) => state.setMapOverlay)
  const saveGame = useGameStore((state) => state.saveGame)
  const loadGame = useGameStore((state) => state.loadGame)
  const confirmRobbery = useGameStore((state) => state.confirmRobbery)

  return (
    <main className="app-shell">
      <section className="map-pane">
        <MapView
          world={world}
          overlayMode={mapOverlay}
          onTileClick={clickTile}
          onCharacterClick={clickCharacter}
        />
      </section>
      <Hud
        world={world}
        actionFeed={actionFeed}
        lastSavedAt={lastSavedAt}
        mapOverlay={mapOverlay}
        onNewWorld={() => regenerate()}
        onEndTurn={endTurn}
        onSetMapOverlay={setMapOverlay}
        onSaveGame={saveGame}
        onLoadGame={loadGame}
        onConfirmRobbery={confirmRobbery}
      />
    </main>
  )
}

export default App
