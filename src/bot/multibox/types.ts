import type { RenderMode } from '../runtime/RenderGate.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';

export type { RenderMode };

export interface Account {
    username: string;
    password: string;
    label?: string;
    // Rail tab restored for this bot; absent means the active tab.
    tab?: string;
}

export interface SlotStatus {
    ready: boolean;
    ingame: boolean;
    // Logged-in character shown on the rail tile once known.
    player: string | null;
    loopCycle: number;
    drawn: number;
    scriptState: string;
}

export interface SlotSnapshot extends SlotStatus {
    id: number;
    username: string;
    focused: boolean;
    mode: RenderMode;
    tab: string;
}

export interface SlotHandle {
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
