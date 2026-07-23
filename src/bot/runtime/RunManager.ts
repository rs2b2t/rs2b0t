import { actions, reader } from '../adapter/ClientAdapter.js';
import { Game } from '../api/Game.js';
import { BotHost } from '../BotHost.js';
import { SettingsStore } from './Settings.js';

const RUN_AUTO_DEFAULT = true;
const ENERGY_MIN_DEFAULT = 20;
const CHECK_MS = 1500;

const CONTROLS_TAB = 12;

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
            return;
        }
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
