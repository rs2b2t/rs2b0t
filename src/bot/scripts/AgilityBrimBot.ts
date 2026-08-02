import type { WorldTile } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Shop } from '../api/hud/Shop.js';

export const BRIM_START = new Tile(2808, 3192, 0);
export const BRIM_COURSE_RADIUS = 10;

export const pressure_pad_west_tile = new Tile(2798, 9579, 3);
export const pressure_pad_west_move_click = new Tile(2799, 9579, 3);
export const pressure_pad_east_tile = new Tile(2801, 9579, 3);
export const pressure_pad_east_move_click = new Tile(2800, 9579, 3);

export const low_hp = 5; // to-do configure this in settings
export const config_food = 'cake';

export function atBrimCourse(here: WorldTile, start: WorldTile = BRIM_START, radius: number = BRIM_COURSE_RADIUS): boolean {
    return Math.max(Math.abs(here.x - start.x), Math.abs(here.z - start.z)) <= radius;
}

export function atBrimCourseInside(here: WorldTile): boolean {
    return here.x >= BrimBlock.min_x() && here.x <= BrimBlock.max_x() &&
        here.z >= BrimBlock.min_y() && here.z <= BrimBlock.max_y() &&
        here.level == 3 || here.level == 0;
}

export function nearPressurePad(here: WorldTile | (WorldTile | null)): boolean {
    
    return !(!here) && Math.max(Math.abs(here.x - pressure_pad_east_tile.x), Math.abs(here.z - pressure_pad_east_tile.z)) <= 7 && here.level == 3;
}

export function findBlockLocation(here: WorldTile): BlockLocation {
    const block = new BrimBlock(here).getLocation();
    return block;
}

export default class AgilityBrimBot extends TaskBot {
    override loopDelay = 600;

    private course: string[] = [];
    private step = 0;
    private radius = 20;
    private laps = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.course = this.settings
            .str('obstacles', '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        this.radius = this.settings.num('searchRadius', 20);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.log(`running agility course: [${this.course.join(' -> ')}] within ${this.radius} tiles`);

        this.add(new ContinueDialog(), new TravelToCourse(this), new GetInside(this), new DoObstacle(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`Agility — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Laps: ${this.laps}`, `XP/hr: ${xph}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void {
        this.status = s;
    }
    searchRadius(): number {
        return this.radius;
    }
    currentName(): string {
        return this.course[this.step];
    }
    courseNames(): string[] {
        return this.course;
    }

    advance(): void {
        this.step++;
        this.laps++;
    }
    resyncTo(name: string): boolean {
        const idx = this.course.indexOf(name);
        if (idx === -1) {
            return false;
        }

        this.log(`course re-sync: step ${this.step} (${this.currentName()}) -> ${idx} (${name})`);
        this.step = idx;
        return true;
    }
}

class TravelToCourse implements Task {
    constructor(private bot: AgilityBrimBot) { }

    validate(): boolean {
        const here = Game.tile();
        if (here == null) {
            return false;
        }
        return !atBrimCourseInside(here!) && !atBrimCourse(here!) ;
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        if (here !== null && !atBrimCourseInside(here)) {
            //this.bot.setStatus(`walking to the Brimhaven agility course - inside = ${!atBrimCourseInside(here)}`);
            if (!atBrimCourse(here)) {
                await Traversal.walkResilient(BRIM_START, {
                    radius: 2,
                    attempts: 6,
                    timeoutMs: 240_000,
                    log: message => this.bot.log(`  ${message}`)
                });
            }
            
        }
    }
}

class GetInside implements Task {
    constructor(private bot: AgilityBrimBot) { }

    validate(): boolean {
        const here = Game.tile();
        if (here == null) {
            return false;
        }
        return !atBrimCourseInside(here!) && atBrimCourse(here!);
    }

    async execute(): Promise<void> {

        const izz = await Npcs.query().name('Cap\'n Izzy No-Beard').action('Pay').first();

        if (izz == null) {
            this.bot.log('no izzy');
        }

        await izz!.interact('Pay');

        await Execution.delayUntil(() => ChatDialog.isOpen() || EventSignal.pending(), 5000);

        
        const ladder = Locs.query()
            .name('Ladder')
            .within(5)
            .where(l => l.actions().some(a => /Climb-Down/i.test(a)))
            .nearest()
            ?? Locs.query().name('Ladder').within(4).nearest();

        if (!ladder) {
            this.bot.log('where ladder');
            return;
        }

        await ladder.interact('Climb-Down');
        await Execution.delayUntil(() => atBrimCourseInside(Game.tile()!) || EventSignal.pending(), 5000);

        const block = findBlockLocation(Game.tile()!);

        if (block.row == 0 && block.column == 4 && block.isUpperLevel) {
            const ropeTile = new Tile(2806, 9587, 3);
            const SWING = { name: 'Rope swing', op: 'Swing-on', stand: new Tile(2806, 9585, 3) };

            await DirectNavigator.walkTo(ropeTile, 0, 600);

            const rope = Locs.query()
                .name(SWING.name)
                .within(4)
                .where(l => l.actions().some(a => /swing-on/i.test(a)))
                .nearest()
                ?? Locs.query().name(SWING.name).within(4).nearest();

            if (!rope) {
                this.bot.log(`no rope swing found at ${ropeTile}`);
                return;
            }
            await rope.interact(SWING.op);

            // to-do if fell down, climb up
        }
    }
}

class DoObstacle implements Task {
    private stuck = 0;

    constructor(private bot: AgilityBrimBot) { }

    validate(): boolean {
        return true;
    }

    async execute(): Promise<void> {
        const beforeXP = Skills.xp('agility');
        const beforeHP = Skills.effective('hitpoints');
        let clicked = false;

        const here = Game.tile();

        const block = findBlockLocation(Game.tile()!);

        this.bot.log(`loc: ${block.row}, ${block.column}, ${block.isUpperLevel}`);

        const food = [config_food, 'herring', 'cod', 'tuna', 'lobster', 'swordfish', 'karambwan'];

        if (Skills.effective('hitpoints') < low_hp) {
            const foodItem = Inventory.items().find(i => food.some(f => i.name?.toLowerCase().includes(f.toLowerCase())));

            const ate = await foodItem?.interact('Eat');
            if (ate) {
                await Execution.delay(600);
            }

            if (foodItem == null || !foodItem || foodItem.count == 0) {
                this.bot.log(`low hp (${Skills.effective('hitpoints')}) but no food in inventory.`);


                let running = true;
                while (running) {
                    this.bot.log('top row');
                    // assume we start west of trap
                    while (block.column == 3 && block.row == 1 && block.isUpperLevel) {
                        this.bot.log('column 3 block');

                        //doenst work iirc
                        while (Skills.effective('hitpoints') < low_hp) {
                            await Execution.delayUntil(() => Skills.effective('hitpoints') > low_hp || EventSignal.pending(), 5000);
                        }

                        clicked = await DirectNavigator.walkTo(pressure_pad_west_move_click, 0, 600);
                        await Execution.delayUntil(() => EventSignal.pending(), 2400);
                    }

                    // now we're east, need to go north
                    while (block.column == 4 && block.row == 1) {
                        this.bot.log('column 4 block');

                        clicked = await DirectNavigator.walkTo(new Tile(2804, 9582, 3), 0, 2400);
                        await Execution.delayUntil(() => here == new Tile(2804, 9582, 3) || !block.isUpperLevel || EventSignal.pending(), 2400);

                        while (block.isUpperLevel) {
                            const rope = Locs.query()
                                .name('Rope swing')
                                .within(4)
                                .where(l => l.actions().some(a => /Swing-on/i.test(a)))
                                .nearest()
                                ?? Locs.query().name('Rope swing').within(4).nearest();

                            if (!rope) {
                                this.bot.log('no rope swing found');
                                return;
                            }

                            await rope.interact('Swing-on');

                            await Execution.delayUntil(() => block.row == 0 || EventSignal.pending(), 2400);
                        }

                        while (!block.isUpperLevel) {
                            clicked = await DirectNavigator.walkTo(new Tile(2805, 9579, 0), 0, 2400);
                            await Execution.delayUntil(() => here == new Tile(2804, 9587, 3) || EventSignal.pending(), 2400);

                            const rope = Locs.query()
                                .name('Climbing rope')
                                .within(5)
                                .where(l => l.actions().some(a => /Climb/i.test(a)))
                                .nearest()
                                ?? Locs.query().name('Ladder').within(4).nearest();

                            if (!rope) {
                                this.bot.log('where climbing rope');
                                return;
                            }

                            await rope.interact('Climb');
                            await Execution.delayUntil(() => block.row == 0 || EventSignal.pending(), 5000);
                        }
                    }

                    while (block.row == 0) {
                        this.bot.log('row 0 block');

                        while (!block.isUpperLevel) {
                            clicked = await DirectNavigator.walkTo(new Tile(2805, 9589, 0), 0, 2400);
                            await Execution.delayUntil(() => here == new Tile(2805, 9589, 0) || EventSignal.pending(), 2400);

                            const neRope = Locs.query()
                                .name('Climbing rope')
                                .within(5)
                                .where(l => l.actions().some(a => /Climb/i.test(a)))
                                .nearest()
                                ?? Locs.query().name('Climbing rope').within(4).nearest();

                            if (!neRope) {
                                this.bot.log('where climbing rope');
                                return;
                            }

                            await neRope.interact('Climb');
                            await Execution.delayUntil(() => block.isUpperLevel || EventSignal.pending(), 5000);
                        }

                        while (block.isUpperLevel) {
                            clicked = await DirectNavigator.walkTo(new Tile(2805, 9589, 3), 0, 2400);
                            await Execution.delayUntil(() => here == new Tile(2805, 9589, 3) || EventSignal.pending(), 2400);

                            const neLadder = Locs.query()
                                .name('Ladder')
                                .within(5)
                                .where(l => l.actions().some(a => /Climb-up/i.test(a)))
                                .nearest()
                                ?? Locs.query().name('Ladder').within(4).nearest();

                            if (!neLadder) {
                                this.bot.log('where ladder');
                                return;
                            }

                            await neLadder.interact('Climb-up');
                            await Execution.delayUntil(() => !atBrimCourseInside(here!) || EventSignal.pending(), 5000);
                        }
                    }

                    while (running) {

                        const dest = new Tile(2793, 3186, 0);
                        clicked = await DirectNavigator.walkTo(dest, 0, 2400);

                        await Execution.delayUntil(() => here == dest || EventSignal.pending(), 2400);

                        const alfo = await Npcs.query().name('Alfonse the waiter').action('Trade').first();
                        await alfo?.interact('Trade');

                        await Execution.delayUntil(() => Shop.isOpen() || EventSignal.pending(), 2400);

                        food.forEach(async f => {
                            if (f == 'swordfish') {
                                await Shop.buy(f, 2);
                            } else if (f == 'karambwan' || f == 'lobster') {
                                await Shop.buy(f, 3);
                            } else if (f == 'herring' || f == 'cod' || f == 'tuna')
                                await Shop.buy(f, 5);
                        });

                        await Shop.close();

                        await Execution.delayUntil(() => !Shop.isOpen() || EventSignal.pending(), 2400);

                        running = false;
                    }
                }

                await Execution.delayUntil(() => Skills.effective('hitpoints') > low_hp || EventSignal.pending(), 5000);
            } else {
                
                await Execution.delayUntil(() => Skills.effective('hitpoints') > low_hp || EventSignal.pending(), 5000);
            }

            return;
        }

        if (Skills.effective('hitpoints') > low_hp) { //
            if (block.row == 1 && (block.column == 3 || block.column == 4) && block.isUpperLevel) {
                if (block.column == 3) {
                    //this.bot.log('move actie 1-3');
                    clicked = await DirectNavigator.walkTo(pressure_pad_west_move_click, 0, 600);
                } else if (block.column == 4) {
                    //this.bot.log('move actie 1-4');
                    clicked = await DirectNavigator.walkTo(pressure_pad_east_move_click, 0, 600);
                }

            }

            if (block.row == 0 && block.column == 4 && block.isUpperLevel) {
                const ropeTile = new Tile(2806, 9587, 3);
                const SWING = { name: 'Rope swing', op: 'Swing-on', stand: new Tile(2806, 9585, 3) };

                clicked = await DirectNavigator.walkTo(ropeTile, 0, 600);

                const rope = Locs.query()
                    .name(SWING.name)
                    .within(4)
                    .where(l => l.actions().some(a => /swing-on/i.test(a)))
                    .nearest()
                    ?? Locs.query().name(SWING.name).within(4).nearest();

                if (!rope) {
                    this.bot.log(`no rope swing found at ${ropeTile}`);
                    return;
                }
                clicked = clicked && await rope.interact(SWING.op);

                // to-do if fell down, climb up
            }

            const cleared = clicked && (
                await Execution.delayUntil(
                    () =>
                        Skills.xp('agility') > beforeXP ||
                        Skills.effective('hitpoints') < beforeHP ||
                        EventSignal.pending(), 700)
            );


            if (!clicked) {
                await Execution.delayTicks(2);
            }

            if (EventSignal.pending()) {
                this.bot.setStatus('random event — handling');
                return;
            }

            let last = Game.tile();
            for (let settle = 0; settle < 25; settle++) {
                await Execution.delayTicks(1);
                if (ChatDialog.canContinue()) {
                    break;
                }
                const now = Game.tile();
                if (now && last && now.x === last.x && now.z === last.z && !Game.animating()) {
                    break;
                }
                last = now;
            }

            if (cleared) {
                this.stuck = 0;
                this.bot.advance();
            } else if (++this.stuck >= 6) {
                this.stuck = 0;
                this.bot.advance();
            } else {
                await this.repositionForRetry();
            }
        }
    }

    private async repositionForRetry(): Promise<void> {
        //await DirectNavigator.walkTo(pressure_pad_east_tile, 0, 600);
        await Traversal.walkTo(pressure_pad_east_tile, { radius: 1, timeoutMs: 600 });
    }
}

export class BlockLocation {
    constructor(public column: number, public row: number, public isUpperLevel: boolean) { }
}

export class BrimBlock {
    constructor(worldTile: WorldTile | null) {
        this.worldTile = worldTile;
    }

    worldTile: WorldTile | null = null;

    getLocation(): BlockLocation {
        return new BlockLocation(this.getColumn, this.getRow, this.worldTile!.level == 3);
    }

    toString(): string {
        return `BrimBlock: ${this.getColumn},${this.getRow}, upper=${this.isUpperLevel}`;
    }


    static min_x(): number {
        return 2759;
    }

    static max_x(): number {
        return 2807;
    } 

    static min_y(): number {
        return 9544;
    }

    static max_y(): number {
        return 9593;
    } 

    static min_y_entrance(): number {
        return 9587;
    }

    location(): string | null {
        if (!this.worldTile) {
            return null;
        }
        return `${this.worldTile.x},${this.worldTile.z}`;
    }

    get isUpperLevel(): boolean {
        switch (this.worldTile!.level) {
            case 3: return true;
            default: return false;
        }
    }

    get getColumn(): number {
        const x = this.worldTile!.x;

        if (x == null || x < BrimBlock.min_x() || x > BrimBlock.max_x()) {
            return -1;
        }

        if (x >= 2801) {        //x_15 = 2801-2807
            return 4;
        } else if (x >= 2792) { //x_14 = 2792-2796
            return 3;
        } else if (x >= 2779) { //x_13 = 2779-2785
            return 2;
        } else if (x >= 2770) { //x_12 = 2770-2777
            return 1;
        } else if (x >= 2759) { // X_11 = 2759-2763
            return 0;
        }

        return -1;
    }

    get getRow(): number {
        const y = this.worldTile!.z;

        if (y == null || y < BrimBlock.min_y() || y > BrimBlock.max_y()) {
            return -1;
        }

        if (y <= 9550) {        
            return 4;
        } else if (y <= 9561) { 
            return 3;
        } else if (y <= 9572) { 
            return 2;
        } else if (y <= 9585) { //y_23 = 9576-9585
            return 1;
        } else if (y <= 9593) { //y_11 = 9586-9593
            return 0;
        }

        return -1;
    }
}



