import type { Player } from '../../api/model/Player.js';
import type Tile from '../../geometry/Tile.js';
import type { MeetingPoint, RuneRoute } from './MuleCrafterLogic.js';

export const ESSENCE = 'Rune essence';
export const ESSENCE_ID = 1436;
export const TEMPLE_Z = 4000;
export const MEETING_RANGE = 4;
export const TRADE_RANGE = 1;
export const ALTAR_APPROACH_RADIUS = 2;

export interface MuleCrafterContext {
    mode(): string;
    rune(): string;
    cfg(): RuneRoute;
    bankTile(): Tile;
    partners(): string[];
    bankFill(): boolean;
    tradesPerBank(): number;
    meetingPoint(): MeetingPoint;
    muleModeActive(): boolean;
    inTemple(): boolean;
    atBank(): boolean;
    atMeetingPoint(): boolean;
    essenceCount(): number;
    runeCount(): number;
    bankDue(): boolean;
    tradeRequestDue(): boolean;
    markTradeRequest(): void;
    isPartner(name: string | null): boolean;
    nearestPartner(range?: number): Player | null;
    currentTile(): Tile | null;
    altarTile(): Tile | null;
    walkTo(dest: Tile, radius?: number): Promise<void>;
    enterAltar(): Promise<boolean>;
    exitAltar(): Promise<boolean>;
    setStatus(status: string): void;
    log(message: string): void;
    countCraft(amount: number): void;
    recordCrafterTrade(amount: number): void;
    recordMuleDelivery(amount: number): void;
    resetTradeCounter(): void;
}
