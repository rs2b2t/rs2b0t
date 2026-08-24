import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Locs } from '../../api/locs/Locs.js';
import { openOp, walkOpening } from '../../event/webwalk/walkOpening.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { nearestShutDoor, obstacleList } from './DoorOpenerLogic.js';

const DEFAULT_STAND = new Tile(3215, 3212, 0);
const DEFAULT_OBSTACLE = 'door, gate';

export const SETTINGS: SettingsSchema = {
    stand: { type: 'tile', default: DEFAULT_STAND, label: 'Stand tile (x,z)', help: 'walk here, then open the nearest adjacent shut door every tick' },
    leashRadius: { type: 'number', default: 8, min: 1, max: 20, label: 'Door search radius (tiles)' },
    obstacle: { type: 'string', default: DEFAULT_OBSTACLE, label: 'Openable names (contains)', help: 'comma-separated name fragments, e.g. door, gate' }
};

export default class DoorOpener extends TaskBot {
    override loopDelay = 600;

    private stand = DEFAULT_STAND;
    private leash = 8;
    private obstacles: string[] = obstacleList(DEFAULT_OBSTACLE);
    private opens = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.stand = this.settings.tile('stand', DEFAULT_STAND);
        this.leash = this.settings.num('leashRadius', 8);
        this.obstacles = obstacleList(this.settings.str('obstacle', DEFAULT_OBSTACLE));
        if (this.obstacles.length === 0) {
            ScriptRunner.stop('DoorOpener: obstacle names are empty');
            return;
        }
        this.startedAt = Date.now();
        this.log(`DoorOpener at ${this.stand} — nearest shut ${this.obstacles.join('/')} within ${this.leash}`);
        this.add(new ContinueDialog(), new OpenNearest(this));
    }

    override recoveryAnchor(): Tile | null {
        return this.stand;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c4a574' });
        p.title(`DoorOpener — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Opens: ${this.opens}`);
        p.row(`Stand: ${this.stand.x},${this.stand.z}`, `Radius: ${this.leash}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordOpen(): void { this.opens++; }
    standTile(): Tile { return this.stand; }
    leashRadius(): number { return this.leash; }
    obstacleNames(): string[] { return this.obstacles; }
}

class OpenNearest implements Task {
    constructor(private bot: DoorOpener) {}
    validate(): boolean { return true; }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        const stand = this.bot.standTile();
        const obstacles = this.bot.obstacleNames();
        const here = Game.tile();
        if (!here || stand.distanceTo(here) > 1) {
            this.bot.setStatus('walking to stand');
            await walkOpening(stand, 1, obstacles, m => this.bot.log(m));
            return;
        }
        const candidates = Locs.query()
            .withinOf(stand, this.bot.leashRadius())
            .results()
            .map(loc => ({ loc, name: loc.name, ops: loc.actions(), distance: loc.tile().distanceTo(stand) }));
        const pick = nearestShutDoor(candidates, obstacles);
        if (!pick || pick.loc.tile().distanceTo(here) > 1) {
            this.bot.setStatus('waiting for a shut door');
            return;
        }
        const door = pick.loc;
        const dt = door.tile();
        const op = openOp(door.actions());
        if (!op) {
            return;
        }
        this.bot.log(`opening ${door.name ?? 'door'} at ${dt.x},${dt.z}`);
        this.bot.setStatus(`opening ${door.name ?? 'door'} at ${dt.x},${dt.z}`);
        if (!(await door.interact(op))) {
            this.bot.log(`could not ${op} ${door.name ?? 'door'} — retrying`);
            return;
        }
        this.bot.recordOpen();
    }
}
