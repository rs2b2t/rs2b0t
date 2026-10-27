import type { RenderMode } from '../runtime/RenderGate.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import type { WorldNumber } from '../../client/config/worlds.js';

export type { RenderMode };

export interface Account {
    username: string;
    password: string;
    world?: WorldNumber;
    label?: string;
    // Rail tab restored for this bot; absent means the active tab.
    tab?: string;
}

export interface SlotStatus {
    ready: boolean;
    ingame: boolean;
    world: WorldNumber | null;
    // Logged-in character shown on the rail tile once known.
    player: string | null;
    loopCycle: number;
    drawn: number;
    scriptState: string;
    scriptName: string | null;
}

export interface SlotSnapshot extends SlotStatus {
    id: number;
    username: string;
    focused: boolean;
    mode: RenderMode;
    tab: string;
    targetWorld: WorldNumber;
    switchingWorld: WorldNumber | null;
    worldSwitchError?: string;
}

export interface SlotHandle {
    reloadWorld(world: WorldNumber): void;
    prepareWorldSwitch(): boolean;
    cancelWorldSwitch(): void;
    setRenderMode(mode: RenderMode): void;
    startScript(): void;
    stopScript(): void;
    setRendererEnabled(enabled: boolean): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
    status(): SlotStatus;
    destroy(): void;
}

export interface SlotOps {
    spawn(account: Account): SlotHandle;
    move(handle: SlotHandle, before: SlotHandle | null): void;
}
