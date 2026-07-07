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

/** Control surface over one bot iframe. Real impl wraps `window.rs2b0t`. */
export interface SlotHandle {
    setRenderMode(mode: RenderMode): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    status(): SlotStatus;
    destroy(): void;
}

/** Creates a slot's iframe + handle. Real impl is DOM; fake impl in tests. */
export interface SlotOps {
    spawn(account: Account): SlotHandle;
}
