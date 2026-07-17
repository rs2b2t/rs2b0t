import { actions, reader } from '../adapter/ClientAdapter.js';
import { Game } from '../api/Game.js';
import { BotHost } from '../BotHost.js';
import { SettingsStore } from './Settings.js';

// Re-enable run once energy has recovered to a useful level. The engine turns
// the orb OFF at 0 energy (Player.ts), so we flip it back on after a regen —
// with a threshold so we run in real bursts instead of flip-flopping back on
// at 1%. Once on, the orb stays on until energy hits 0 again, and the game
// seamlessly walks-at-0 / runs-when-there's-energy in between. Both the
// on/off switch and the threshold are Global settings (runAuto/runEnergyMin,
// panel-editable live) — defaults here are the fallbacks for a bag miss.
const RUN_AUTO_DEFAULT = true;
const ENERGY_MIN_DEFAULT = 20; // percent
const CHECK_MS = 1500;

// The run toggle is [if_button,controls:com_5] on the player-controls interface,
// which the login script attaches to side-tab slot 12 (^tab_player_controls) —
// but ONLY off Tutorial Island. On the island that tab is absent, so an
// if_button click there is rejected server-side; gate on the tab being attached
// so we don't fire useless packets while a fresh account is still on the island.
// (Switching the active tab is a client-only redraw with no packet, so the
// direct toggle works regardless of which tab is showing.)
const CONTROLS_TAB = 12;

/**
 * Keeps the run orb ON whenever there's energy to spend — for EVERY bot and
 * every kind of movement (web-walks, scene steps, banking trips). The walkers
 * don't manage run themselves, so without this the characters walk everywhere.
 * Installed once from main.ts; runs off the frame hook like AutoRelogin/StallGuard.
 */
class RunManagerImpl {
    private enabled = false;
    private nextCheckAt = 0;

    enable(): void {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    private onFrame(): void {
        const now = performance.now();
        if (now < this.nextCheckAt) {
            return;
        }
        this.nextCheckAt = now + CHECK_MS;

        if (!reader.ingame() || reader.sideTabInterface(CONTROLS_TAB) === -1) {
            return; // not in-game, or still on Tutorial Island (no controls tab)
        }
        // resolved per check so panel edits apply live, no restart needed
        const globals = SettingsStore.globalBag();
        if (!globals.bool('runAuto', RUN_AUTO_DEFAULT)) {
            return;
        }
        if (!Game.runEnabled() && Game.energy() >= globals.num('runEnergyMin', ENERGY_MIN_DEFAULT)) {
            actions.setRun(true);
        }
    }
}

export const RunManager = new RunManagerImpl();
