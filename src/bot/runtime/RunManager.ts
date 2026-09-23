import { actions, reader } from '../adapter/ClientAdapter.js';
import { Game } from '../api/game/Game.js';
import { BotHost } from './BotHost.js';
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

/** Script-written session overlay. Unset fields fall through to Global. A later call replaces the whole snapshot. */
export interface RunPolicyOverride {
    runAuto?: boolean;
    energyMin?: number;
}

export function resolveRunPolicy(
    over: RunPolicyOverride | null | undefined,
    globals: { runAuto: boolean; energyMin: number }
): { runAuto: boolean; energyMin: number } {
    const energyMin = over?.energyMin ?? globals.energyMin;
    return {
        runAuto: over?.runAuto ?? globals.runAuto,
        energyMin: Math.max(0, Math.min(100, energyMin))
    };
}

// under attack the regen floor is ignored: walking away from a fight never loses it
export function shouldEnableRun(s: RunState): boolean {
    if (s.runOn) {
        return false;
    }
    // Why: toggling run clicks a component in the controls tab and the server closes the open modal to service it, enough to shut a bank mid-trip and leave the script reading an empty bank (#117).
    // Why: nothing needs run while a modal is up, and being attacked still overrides because getting away beats the modal.
    if (s.modalOpen && !s.inCombat) {
        return false;
    }
    return s.energy >= (s.inCombat ? ENERGY_MIN_ATTACKED : s.energyMin);
}

class RunManagerImpl {
    private enabled = false;
    private nextCheckAt = 0;
    private policyOverride: RunPolicyOverride | null = null;

    enable(): void {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    /** Last call wins as a whole snapshot. `null` returns to Global. Cleared when a script starts or stops. */
    override(policy: RunPolicyOverride | null): void {
        this.policyOverride = policy;
    }

    private onFrame(): void {
        // being hit is urgent, don't sit out the throttle waiting to turn run on
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
        const policy = resolveRunPolicy(this.policyOverride, {
            runAuto: globals.bool('runAuto', RUN_AUTO_DEFAULT),
            energyMin: globals.num('runEnergyMin', ENERGY_MIN_DEFAULT)
        });
        if (!policy.runAuto) {
            return;
        }
        const state: RunState = {
            runOn: Game.runEnabled(),
            inCombat: Game.inCombat(),
            energy: Game.energy(),
            energyMin: policy.energyMin,
            modalOpen: reader.modals().main !== -1
        };
        if (shouldEnableRun(state)) {
            actions.setRun(true);
        }
    }
}

export const RunManager = new RunManagerImpl();
