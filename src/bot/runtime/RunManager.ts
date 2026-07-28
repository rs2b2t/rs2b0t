import { actions, reader } from '../adapter/ClientAdapter.js';
import { Game } from '../api/Game.js';
import { BotHost } from '../BotHost.js';
import { SettingsStore } from './Settings.js';

const RUN_AUTO_DEFAULT = true;
const ENERGY_MIN_DEFAULT = 20;
const ENERGY_MIN_ATTACKED = 1; // any energy at all is worth spending to break off
const CHECK_MS = 1500;

const CONTROLS_TAB = 12;

export interface RunState {
    runOn: boolean;
    inCombat: boolean;
    energy: number;
    energyMin: number;
    modalOpen: boolean;
}

// under attack the regen floor is ignored: walking away from a fight never loses it
export function shouldEnableRun(s: RunState): boolean {
    if (s.runOn) {
        return false;
    }
    // Toggling run clicks a component in the controls tab, and the server closes the
    // open modal to service it — enough to shut a bank mid-trip and leave the script
    // reading an empty bank (#117). Nothing needs run while a modal is up, so wait
    // for it to close. Being attacked still overrides: getting away beats the modal.
    if (s.modalOpen && !s.inCombat) {
        return false;
    }
    return s.energy >= (s.inCombat ? ENERGY_MIN_ATTACKED : s.energyMin);
}

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
        // being hit is urgent — don't sit out the throttle waiting to turn run on
        const attacked = !Game.runEnabled() && Game.inCombat();
        const now = performance.now();
        if (now < this.nextCheckAt && !attacked) {
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
        const state: RunState = {
            runOn: Game.runEnabled(),
            inCombat: Game.inCombat(),
            energy: Game.energy(),
            energyMin: globals.num('runEnergyMin', ENERGY_MIN_DEFAULT),
            modalOpen: reader.modals().main !== -1
        };
        if (shouldEnableRun(state)) {
            actions.setRun(true);
        }
    }
}

export const RunManager = new RunManagerImpl();
