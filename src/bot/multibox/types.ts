import type { RenderMode } from '../runtime/RenderGate.js';

export type { RenderMode };

export interface Account {
    username: string;
    password: string;
    label?: string;
}

export interface SlotStatus {
    ready: boolean;
    ingame: boolean;
    // the logged-in character, once known — a bot is added empty and gets its
    // account typed into its own panel, so this is what the rail tile shows
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
}

export interface SlotHandle {
    setRenderMode(mode: RenderMode): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    status(): SlotStatus;
    destroy(): void;
}

export interface SlotOps {
    spawn(account: Account): SlotHandle;
}
