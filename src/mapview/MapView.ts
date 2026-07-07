import GameShell from '#/client/GameShell.js';
import Pix32 from '#/graphics/Pix32.js';
import Pix2D from '#/graphics/Pix2D.js';
import Pix8 from '#/graphics/Pix8.js';
import PixFont from '#/graphics/PixFont.js';
import JagFile from '#/io/JagFile.js';
import Packet from '#/io/Packet.js';
import { TypedArray1d, TypedArray2d } from '#/util/Arrays.js';
import { downloadUrl, sleep } from '#/util/JsUtil.js';
import { canvas, saveDataURL } from '#/graphics/Canvas.js';
import PixMap from '#/graphics/PixMap.js';
import WorldMapFont from '#/mapview/WorldMapFont.js';

export class MapView extends GameShell {
    static shouldDrawBorders: boolean = false;
    static shouldDrawLabels: boolean = true;

    static shouldDrawNpcs: boolean = false;
    static shouldDrawItems: boolean = false;
    static shouldDrawMultimap: boolean = false;
    static shouldDrawFreemap: boolean = false;

    mapStartX: number = 50 << 6;
    mapStartZ: number = 50 << 6;
    mapWidth: number = 25 << 6;
    mapHeight: number = 19 << 6;
    mapOriginX: number = 32 << 6;
    mapOriginZ: number = 44 << 6;
    focusX: number = this.mapStartX - this.mapOriginX;
    focusZ: number = this.mapOriginZ + this.mapHeight - this.mapStartZ;

    // custom:
    mapArea: number = 0;

    readonly maxLabelCount: number = 1000;
    mapLabelCount: number = 0;
    mapLabel: string[] = [];
    mapLabelX: number[] = [];
    mapLabelY: number[] = [];
    mapLabelSize: number[] = [];

    // floorcol.dat
    floorcol1: number[] = [0];
    floorcol2: number[] = [0];

    // underlay.dat
    floort1: number[][] = [];

    // overlay.dat
    floort2: number[][] = [];
    floorsr: number[][] = [];

    // loc.dat
    locWall: number[][] = [];
    locMapscene: number[][] = [];
    locMapfunction: number[][] = [];

    // custom: obj.dat
    objPos: boolean[][] = [];

    // custom: npc.dat
    npcPos: boolean[][] = [];

    // custom: multi.dat
    multiPos: boolean[][] = [];

    // custom: free.dat
    freePos: boolean[][] = [];

    mapscene: Pix8[] = [];
    mapfunction: Pix32[] = [];
    mapdot0: Pix32 | null = null;
    mapdot1: Pix32 | null = null;

    b12: PixFont | null = null;
    f11: WorldMapFont | null = null;
    f12: WorldMapFont | null = null;
    f14: WorldMapFont | null = null;
    f17: WorldMapFont | null = null;
    f19: WorldMapFont | null = null;
    f22: WorldMapFont | null = null;
    f26: WorldMapFont | null = null;
    f30: WorldMapFont | null = null;

    blendedGroundColour: number[][] = [];

    redraw: boolean = true;
    redrawTimer: number = 0;
    dragFocusX: number = -1;
    dragFocusZ: number = -1;

    keyX: number = 5;
    keyY: number = 13;
    keyWidth: number = 140;
    keyHeight: number = 470;
    showKey: boolean = false;
    keyPage: number = 0;
    lastKeyPage: number = 0;
    currentKeyHover: number = -1;
    lastKeyHover: number = 0;
    currentKey: number = 0;
    flashTimer: number = 0;

    visibleMapFunctionsX: Int32Array = new Int32Array(2000);
    visibleMapFunctionsY: Int32Array = new Int32Array(2000);
    visibleMapFunctions: Int32Array = new Int32Array(2000);
    activeMapFunctionX: Int32Array = new Int32Array(2000);
    activeMapFunctionZ: Int32Array = new Int32Array(2000);
    activeMapFunctions: Int32Array = new Int32Array(2000);
    activeMapFunctionCount: number = 0;

    overview: Pix32 | null = null;
    overviewHeight: number = 200;
    overviewWidth: number = ((this.overviewHeight * this.mapWidth) / this.mapHeight) | 0;
    overviewX: number = 635 - this.overviewWidth - 5;
    overviewY: number = 503 - this.overviewHeight - 20;
    showOverview: boolean = false;

    readonly INACTIVE_BORDER_TL: number = 0x887755;
    readonly INACTIVE: number = 0x776644;
    readonly INACTIVE_BORDER_BR: number = 0x665533;
    readonly ACTIVE_BORDER_TL: number = 0xaa0000;
    readonly ACTIVE: number = 0x990000;
    readonly ACTIVE_BORDER_BR: number = 0x880000;

    zoom: number = 4;
    targetZoom: number = 4;

    readonly keyNames: string[] = [
        'General Store',
        'Sword Shop',
        'Magic Shop',
        'Axe Shop',
        'Helmet Shop',
        'Bank',
        'Quest Start',
        'Amulet Shop',
        'Mining Site',
        'Furnace',
        'Anvil',
        'Combat Training',
        'Dungeon',
        'Staff Shop',
        'Platebody Shop',
        'Platelegs Shop',
        'Scimitar Shop',
        'Archery Shop',
        'Shield Shop',
        'Altar',
        'Herbalist',
        'Jewelery',
        'Gem Shop',
        'Crafting Shop',
        'Candle Shop',
        'Fishing Shop',
        'Fishing Spot',
        'Clothes Shop',
        'Apothecary',
        'Silk Trader',
        'Kebab Seller',
        'Pub/Bar',
        'Mace Shop',
        'Tannery',
        'Rare Trees',
        'Spinning Wheel',
        'Food Shop',
        'Cookery Shop',
        '???',
        'Water Source',
        'Cooking Range',
        'Skirt Shop',
        'Potters Wheel',
        'Windmill',
        'Mining Shop',
        'Chainmail Shop',
        'Silver Shop',
        'Fur Trader',
        'Spice Shop'
    ];

    constructor() {
        super();

        this.run();
    }

    override async maininit(): Promise<void> {
        // custom:
        this.keyHeight = this.sHei - this.keyY - 20;
        this.overviewX = this.sWid - this.overviewWidth - 5;
        this.overviewY = this.sHei - this.overviewHeight - 20;
        this.fullredraw = true;
        canvas.style.cursor = 'grab';

        const worldmap: JagFile = await this.loadWorldmap();

        await this.drawProgress('Please wait... Rendering Map', 100);

        // const size: Packet = new Packet(worldmap.read('size.dat'));
        // this.mapOriginX = size.g2();
        // this.mapOriginZ = size.g2();
        // this.mapWidth = size.g2();
        // this.mapHeight = size.g2();
        // this.focusX = this.mapStartX - this.mapOriginX;
        // this.focusZ = this.mapOriginZ + this.mapHeight - this.mapStartZ;

        const labels: Packet = new Packet(worldmap.read('labels.dat'));
        this.mapLabelCount = labels.g2();
        for (let i: number = 0; i < this.mapLabelCount; i++) {
            this.mapLabel[i] = labels.gjstr();
            this.mapLabelX[i] = labels.g2();
            this.mapLabelY[i] = labels.g2();
            this.mapLabelSize[i] = labels.g1();
        }

        const floorcol: Packet = new Packet(worldmap.read('floorcol.dat'));
        const floorcolCount: number = floorcol.g2();
        for (let i: number = 0; i < floorcolCount; i++) {
            this.floorcol1[i + 1] = floorcol.g4();
            this.floorcol2[i + 1] = floorcol.g4();
        }

        const underlay: Packet = new Packet(worldmap.read('underlay.dat'));
        this.floort1 = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.loadUnderlay(underlay);

        const overlay: Packet = new Packet(worldmap.read('overlay.dat'));
        this.floort2 = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.floorsr = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.loadOverlay(overlay);

        const loc: Packet = new Packet(worldmap.read('loc.dat'));
        this.locWall = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.locMapscene = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.locMapfunction = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.loadLoc(loc);

        try {
            // custom:
            const obj: Packet = new Packet(worldmap.read('obj.dat'));
            this.objPos = new TypedArray2d(this.mapWidth, this.mapHeight, false);
            this.loadObj(obj);

            // custom:
            const npc: Packet = new Packet(worldmap.read('npc.dat'));
            this.npcPos = new TypedArray2d(this.mapWidth, this.mapHeight, false);
            this.loadNpc(npc);

            // custom:
            const multi: Packet = new Packet(worldmap.read('multi.dat'));
            this.multiPos = new TypedArray2d(this.mapWidth, this.mapHeight, false);
            this.loadMulti(multi);

            // custom:
            const free: Packet = new Packet(worldmap.read('free.dat'));
            this.freePos = new TypedArray2d(this.mapWidth, this.mapHeight, false);
            this.loadFree(free);
        } catch (_e) {
        }

        try {
            for (let i: number = 0; i < 100; i++) {
                this.mapscene[i] = Pix8.depack(worldmap, 'mapscene', i);
            }
        } catch (_e) {
            // empty
        }

        try {
            for (let i: number = 0; i < 100; i++) {
                this.mapfunction[i] = Pix32.depack(worldmap, 'mapfunction', i);
            }
        } catch (_e) {
            // empty
        }

        // custom:
        try {
            this.mapdot0 = Pix32.depack(worldmap, 'mapdots', 0);
            this.mapdot1 = Pix32.depack(worldmap, 'mapdots', 1);
        } catch (_e) {
        }

        this.b12 = PixFont.depack(worldmap, 'b12_full', false);

        // custom:
        try {
            this.f11 = WorldMapFont.load(worldmap, 'f11');
            this.f12 = WorldMapFont.load(worldmap, 'f12');
            this.f14 = WorldMapFont.load(worldmap, 'f14');
            this.f17 = WorldMapFont.load(worldmap, 'f17');
            this.f19 = WorldMapFont.load(worldmap, 'f19');
            this.f22 = WorldMapFont.load(worldmap, 'f22');
            this.f26 = WorldMapFont.load(worldmap, 'f26');
            this.f30 = WorldMapFont.load(worldmap, 'f30');
        } catch (err) {
            console.error(err);
            this.f11 = WorldMapFont.fromSystem(11, true);
            this.f12 = WorldMapFont.fromSystem(12, true);
            this.f14 = WorldMapFont.fromSystem(14, true);
            this.f17 = WorldMapFont.fromSystem(17, true);
            this.f19 = WorldMapFont.fromSystem(19, true);
            this.f22 = WorldMapFont.fromSystem(22, true);
            this.f26 = WorldMapFont.fromSystem(26, true);
            this.f30 = WorldMapFont.fromSystem(30, true);
        }

        this.blendedGroundColour = new TypedArray2d(this.mapWidth, this.mapHeight, 0);
        this.getBlendedGroundColour();

        this.overview = new Pix32(this.overviewWidth, this.overviewHeight);
        this.overview.setPixels();
        this.renderWorldMap(0, 0, this.mapWidth, this.mapHeight, 0, 0, this.overviewWidth, this.overviewHeight);
        Pix2D.drawRect(0, 0, this.overviewWidth, this.overviewHeight, 0);
        Pix2D.drawRect(1, 1, this.overviewWidth - 2, this.overviewHeight - 2, this.INACTIVE_BORDER_TL);

        this.drawArea?.setPixels();
    }

    override async mainredraw(): Promise<void> {
        if (this.redraw) {
            this.redraw = false;
            this.redrawTimer = 0;

            Pix2D.cls();

            const left: number = this.focusX - ((this.sWid / this.zoom) | 0);
            const top: number = this.focusZ - ((this.sHei / this.zoom) | 0);
            const right: number = this.focusX + ((this.sWid / this.zoom) | 0);
            const bottom: number = this.focusZ + ((this.sHei / this.zoom) | 0);
            this.renderWorldMap(left, top, right, bottom, 0, 0, this.sWid, this.sHei);

            if (this.showOverview) {
                this.overview?.quickPlotSprite(this.overviewX, this.overviewY);

                Pix2D.fillRectTrans(
                    (this.overviewX + (this.overviewWidth * left) / this.mapWidth) | 0,
                    (this.overviewY + (this.overviewHeight * top) / this.mapHeight) | 0,
                    (((right - left) * this.overviewWidth) / this.mapWidth) | 0,
                    (((bottom - top) * this.overviewHeight) / this.mapHeight) | 0,
                    0xff0000,
                    0x80
                );
                Pix2D.drawRect(
                    (this.overviewX + (this.overviewWidth * left) / this.mapWidth) | 0,
                    (this.overviewY + (this.overviewHeight * top) / this.mapHeight) | 0,
                    (((right - left) * this.overviewWidth) / this.mapWidth) | 0,
                    (((bottom - top) * this.overviewHeight) / this.mapHeight) | 0,
                    0xff0000
                );

                if (this.flashTimer > 0 && this.flashTimer % 10 < 5) {
                    for (let i: number = 0; i < this.activeMapFunctionCount; i++) {
                        if (this.activeMapFunctions[i] == this.currentKey) {
                            const x: number = (this.overviewX + (this.overviewWidth * this.activeMapFunctionX[i]) / this.mapWidth) | 0;
                            const y: number = (this.overviewY + (this.overviewHeight * this.activeMapFunctionZ[i]) / this.mapHeight) | 0;
                            Pix2D.fillCircle(x, y, 2, 0xffff00, 256);
                        }
                    }
                }
            }

            if (this.showKey) {
                this.drawStringBox(this.keyX, this.keyY, this.keyWidth, 18, 0x999999, 0x777777, 0x555555, 'Prev page');
                this.drawStringBox(this.keyX, this.keyY + 18, this.keyWidth, this.keyHeight - 36, 0x999999, 0x777777, 0x555555, '');
                this.drawStringBox(this.keyX, this.keyY + this.keyHeight - 18, this.keyWidth, 18, 0x999999, 0x777777, 0x555555, 'Next page');

                const maxKeys: number = (this.keyHeight - 20) / 18;
                let y: number = this.keyY + 18 + 3;

                for (let row: number = 0; row < maxKeys; row++) {
                    if (row + this.lastKeyPage < this.mapfunction.length && row + this.lastKeyPage < this.keyNames.length) {
                        if (this.keyNames[row + this.lastKeyPage] === '???') {
                            continue;
                        }

                        this.mapfunction[row + this.lastKeyPage].plotSprite(this.keyX + 3, y);
                        this.b12?.drawString(this.keyNames[row + this.lastKeyPage], this.keyX + 21, y + 14, 0);

                        let rgb: number = 0xffffff;
                        if (this.currentKeyHover == row + this.lastKeyPage) {
                            rgb = 0xbbaaaa;
                        }
                        if (this.flashTimer > 0 && this.flashTimer % 10 < 5 && this.currentKey == row + this.lastKeyPage) {
                            rgb = 0xffff00;
                        }

                        this.b12?.drawString(this.keyNames[row + this.lastKeyPage], this.keyX + 20, y + 13, rgb);
                    }

                    y += 17;
                }
            }

            this.drawStringBox(this.overviewX, this.overviewY + this.overviewHeight, this.overviewWidth, 18, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, 'Overview');
            this.drawStringBox(this.keyX, this.keyY + this.keyHeight, this.keyWidth, 18, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, 'Key');

            const y = this.sHei - this.keyY - 20 + 1;
            if (this.targetZoom == 3.0) {
                this.drawStringBox(170, y, 50, 30, this.ACTIVE_BORDER_TL, this.ACTIVE, this.ACTIVE_BORDER_BR, '37%');
            } else {
                this.drawStringBox(170, y, 50, 30, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, '37%');
            }

            if (this.targetZoom == 4.0) {
                this.drawStringBox(230, y, 50, 30, this.ACTIVE_BORDER_TL, this.ACTIVE, this.ACTIVE_BORDER_BR, '50%');
            } else {
                this.drawStringBox(230, y, 50, 30, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, '50%');
            }

            if (this.targetZoom == 6.0) {
                this.drawStringBox(290, y, 50, 30, this.ACTIVE_BORDER_TL, this.ACTIVE, this.ACTIVE_BORDER_BR, '75%');
            } else {
                this.drawStringBox(290, y, 50, 30, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, '75%');
            }

            if (this.targetZoom == 8.0) {
                this.drawStringBox(350, y, 50, 30, this.ACTIVE_BORDER_TL, this.ACTIVE, this.ACTIVE_BORDER_BR, '100%');
            } else {
                this.drawStringBox(350, y, 50, 30, this.INACTIVE_BORDER_TL, this.INACTIVE, this.INACTIVE_BORDER_BR, '100%');
            }
        }

        this.redrawTimer--;
        if (this.redrawTimer <= 0) {
            this.drawArea?.draw(0, 0);
            this.redrawTimer = 50;
        }
    }

    override refresh() {
        this.redrawTimer = 0;
    }

    override async mainloop(): Promise<void> {
        if (this.keyHeld[1] == 1) {
            this.focusX = (this.focusX - 16.0 / this.zoom) | 0;
            this.redraw = true;
        }
        if (this.keyHeld[2] == 1) {
            this.focusX = (this.focusX + 16.0 / this.zoom) | 0;
            this.redraw = true;
        }
        if (this.keyHeld[3] == 1) {
            this.focusZ = (this.focusZ - 16.0 / this.zoom) | 0;
            this.redraw = true;
        }
        if (this.keyHeld[4] == 1) {
            this.focusZ = (this.focusZ + 16.0 / this.zoom) | 0;
            this.redraw = true;
        }

        let key: number = 1;
        do {
            key = this.pollKey();
            if (key === -1) {
                break;
            }

            if (key == '1'.charCodeAt(0)) {
                this.targetZoom = 3.0;
                this.redraw = true;
            } else if (key == '2'.charCodeAt(0)) {
                this.targetZoom = 4.0;
                this.redraw = true;
            } else if (key == '3'.charCodeAt(0)) {
                this.targetZoom = 6.0;
                this.redraw = true;
            } else if (key == '4'.charCodeAt(0)) {
                this.targetZoom = 8.0;
                this.redraw = true;
            } else if (key == 'k'.charCodeAt(0) || key == 'K'.charCodeAt(0)) {
                this.showKey = !this.showKey;
                this.redraw = true;
            } else if (key == 'o'.charCodeAt(0) || key == 'O'.charCodeAt(0)) {
                this.showOverview = !this.showOverview;
                this.redraw = true;
            } else if (key == 'e'.charCodeAt(0) || key == 'E'.charCodeAt(0)) {
                const width = this.mapWidth * 2;
                const height = this.mapHeight * 2;

                const fullRender = new Pix32(width, height);
                fullRender.setPixels();
                this.renderWorldMap(0, 0, this.mapWidth, this.mapHeight, 0, 0, width, height);

                const canvas = document.createElement('canvas') as HTMLCanvasElement;
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d')!;
                const out = new PixMap(width, height, ctx);
                out.setPixels();
                fullRender.quickPlotSprite(0, 0);
                out.draw(0, 0);

                this.drawArea?.setPixels();

                const map = canvas.toDataURL('image/png').replace(/^data:image\/[^;]/, 'data:application/octet-stream');
                saveDataURL(map, 'worldmap.png');
            } else if (key == 'n'.charCodeAt(0) || key == 'N'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawNpcs = !MapView.shouldDrawNpcs;
                this.redraw = true;
            } else if (key == 'i'.charCodeAt(0) || key == 'I'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawItems = !MapView.shouldDrawItems;
                this.redraw = true;
            } else if (key == 'l'.charCodeAt(0) || key == 'L'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawLabels = !MapView.shouldDrawLabels;
                this.redraw = true;
            } else if (key == 'b'.charCodeAt(0) || key == 'B'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawBorders = !MapView.shouldDrawBorders;
                this.redraw = true;
            } else if (key == 'm'.charCodeAt(0) || key == 'M'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawMultimap = !MapView.shouldDrawMultimap;
                this.redraw = true;
            } else if (key == 'f'.charCodeAt(0) || key == 'F'.charCodeAt(0)) {
                // custom:
                MapView.shouldDrawFreemap = !MapView.shouldDrawFreemap;
                this.redraw = true;
            } else if (key === '['.charCodeAt(0)) {
                // custom:
                await this.reloadMain();
            } else if (key === ']'.charCodeAt(0)) {
                // custom:
                await this.reloadDungeon();
            } else if (key === '\\'.charCodeAt(0)) {
                // custom:
                await this.reloadExtra();
            }
        } while (key > 0);

        if (this.mouseClickButton == 1) {
            this.nextMouseClickX = this.mouseClickX;
            this.nextMouseClickY = this.mouseClickY;
            this.dragFocusX = this.focusX;
            this.dragFocusZ = this.focusZ;

            const zoomY: number = this.sHei - this.keyY - 20 + 1;
            if (this.mouseClickX > 170 && this.mouseClickX < 220 && this.mouseClickY > zoomY) {
                this.targetZoom = 3.0;
                this.nextMouseClickX = -1;
            } else if (this.mouseClickX > 230 && this.mouseClickX < 280 && this.mouseClickY > zoomY) {
                this.targetZoom = 4.0;
                this.nextMouseClickX = -1;
            } else if (this.mouseClickX > 290 && this.mouseClickX < 340 && this.mouseClickY > zoomY) {
                this.targetZoom = 6.0;
                this.nextMouseClickX = -1;
            } else if (this.mouseClickX > 350 && this.mouseClickX < 400 && this.mouseClickY > zoomY) {
                this.targetZoom = 8.0;
                this.nextMouseClickX = -1;
            } else if (this.mouseClickX > this.keyX && this.mouseClickY > this.keyY + this.keyHeight && this.mouseClickX < this.keyX + this.keyWidth) {
                this.showKey = !this.showKey;
                this.nextMouseClickX = -1;
            } else if (this.mouseClickX > this.overviewX && this.mouseClickY > this.overviewY + this.overviewHeight && this.mouseClickX < this.overviewX + this.overviewWidth) {
                this.showOverview = !this.showOverview;
                this.nextMouseClickX = -1;
            }

            if (this.showKey) {
                if (this.mouseClickX > this.keyX && this.mouseClickY > this.keyY && this.mouseClickX < this.keyX + this.keyWidth && this.mouseClickY < this.keyY + this.keyHeight) {
                    this.nextMouseClickX = -1;
                }

                if (this.mouseClickX > this.keyX && this.mouseClickY > this.keyY && this.mouseClickX < this.keyX + this.keyWidth && this.mouseClickY < this.keyY + 18) {
                    this.keyPage = 0;
                } else if (this.mouseClickX > this.keyX && this.mouseClickY > this.keyY + this.keyHeight - 18 && this.mouseClickX < this.keyX + this.keyWidth && this.mouseClickY < this.keyY + this.keyHeight) {
                    this.keyPage = 25;
                }
            }

            this.redraw = true;
        }

        if (this.showKey) {
            this.currentKeyHover = -1;

            if (this.mouseX > this.keyX && this.mouseX < this.keyX + this.keyWidth) {
                const maxKeys: number = (this.keyHeight - 20) / 18;
                let y: number = this.keyY + 21 + 5;

                for (let row: number = 0; row < maxKeys; row++) {
                    if (row + this.lastKeyPage < this.keyNames.length && this.keyNames[row + this.lastKeyPage] !== '???') {
                        if (this.mouseY >= y && this.mouseY < y + 17) {
                            this.currentKeyHover = row + this.lastKeyPage;

                            if (this.mouseClickButton == 1) {
                                this.currentKey = row + this.lastKeyPage;
                                this.flashTimer = 50;
                            }
                        }

                        y += 17;
                    }
                }
            }

            if (this.currentKeyHover != this.lastKeyHover) {
                this.lastKeyHover = this.currentKeyHover;
                this.redraw = true;
            }
        }

        if ((this.mouseButton == 1 || this.mouseClickButton == 1) && this.showOverview) {
            let mouseClickX: number = this.mouseClickX;
            let mouseClickY: number = this.mouseClickY;
            if (this.mouseButton == 1) {
                mouseClickX = this.mouseX;
                mouseClickY = this.mouseY;
            }

            if (mouseClickX > this.overviewX && mouseClickY > this.overviewY && mouseClickX < this.overviewX + this.overviewWidth && mouseClickY < this.overviewY + this.overviewHeight) {
                this.focusX = (((mouseClickX - this.overviewX) * this.mapWidth) / this.overviewWidth) | 0;
                this.focusZ = (((mouseClickY - this.overviewY) * this.mapHeight) / this.overviewHeight) | 0;
                this.nextMouseClickX = -1;
                this.redraw = true;
            }
        }

        if (this.mouseButton == 1 && this.nextMouseClickX != -1) {
            this.focusX = this.dragFocusX + ((((this.nextMouseClickX - this.mouseX) * 2.0) / this.targetZoom) | 0);
            this.focusZ = this.dragFocusZ + ((((this.nextMouseClickY - this.mouseY) * 2.0) / this.targetZoom) | 0);
            this.redraw = true;
        }

        if (this.zoom < this.targetZoom) {
            this.redraw = true;
            this.zoom += this.zoom / 30.0;
            if (this.zoom > this.targetZoom) {
                this.zoom = this.targetZoom;
            }
        }

        if (this.zoom > this.targetZoom) {
            this.redraw = true;
            this.zoom -= this.zoom / 30.0;
            if (this.zoom < this.targetZoom) {
                this.zoom = this.targetZoom;
            }
        }

        if (this.lastKeyPage < this.keyPage) {
            this.redraw = true;
            this.lastKeyPage++;
        }

        if (this.lastKeyPage > this.keyPage) {
            this.redraw = true;
            this.lastKeyPage--;
        }

        if (this.flashTimer > 0) {
            this.redraw = true;
            this.flashTimer--;
        }

        const left: number = this.focusX - ((this.sWid / this.zoom) | 0);
        const top: number = this.focusZ - ((this.sHei / this.zoom) | 0);
        const right: number = this.focusX + ((this.sWid / this.zoom) | 0);
        const bottom: number = this.focusZ + ((this.sHei / this.zoom) | 0);
        if (left < 48) {
            this.focusX = ((this.sWid / this.zoom) | 0) + 48;
        }
        if (top < 48) {
            this.focusZ = ((this.sHei / this.zoom) | 0) + 48;
        }
        if (right > this.mapWidth - 48) {
            this.focusX = this.mapWidth - 48 - ((this.sWid / this.zoom) | 0);
        }
        if (bottom > this.mapHeight - 48) {
            this.focusZ = this.mapHeight - 48 - ((this.sHei / this.zoom) | 0);
        }
    }

    // ----

    worldmap: JagFile | null = null;

    async loadWorldmap(): Promise<JagFile> {
        if (this.worldmap) {
            return this.worldmap;
        }

        // todo: save to cache and redownload if necessary
        let data: Uint8Array | undefined = undefined;

        let retry: number = 5;
        while (!data) {
            await this.drawProgress('Requesting map', 0);

            try {
                data = await downloadUrl('/worldmap.jag');
            } catch (_e) {
                data = undefined;
                for (let i: number = retry; i > 0; i--) {
                    await this.drawProgress(`Error loading - Will retry in ${i} secs.`, 0);
                    await sleep(1000);
                }

                retry *= 2;
                if (retry > 60) {
                    retry = 60;
                }
            }
        }

        this.worldmap = new JagFile(data);
        return this.worldmap;
    }

    drawStringBox(x: number, y: number, width: number, height: number, borderTL: number, fill: number, borderBR: number, str: string): void {
        x = Math.trunc(x);
        y = Math.trunc(y);
        width = Math.trunc(width);
        height = Math.trunc(height);

        Pix2D.drawRect(x, y, width, height, 0);

        const xPad: number = x + 1;
        const yPad: number = y + 1;
        const widthPad: number = width - 2;
        const heightPad: number = height - 2;

        Pix2D.fillRect(xPad, yPad, widthPad, heightPad, fill);
        Pix2D.hline(xPad, yPad, widthPad, borderTL);
        Pix2D.vline(xPad, yPad, heightPad, borderTL);
        Pix2D.hline(xPad, yPad + heightPad - 1, widthPad, borderBR);
        Pix2D.vline(xPad + widthPad - 1, yPad, heightPad, borderBR);

        this.b12?.centreString(str, xPad + ((widthPad / 2) | 0) + 1, yPad + ((heightPad / 2) | 0) + 1 + 4, 0);
        this.b12?.centreString(str, xPad + ((widthPad / 2) | 0), yPad + ((heightPad / 2) | 0) + 4, 0xffffff);
    }

    // jag::oldscape::rs2lib::worldmap::RenderedMapSquare::GetBlendedGroundColour
    getBlendedGroundColour(): void {
        const maxX: number = this.mapWidth;
        const maxZ: number = this.mapHeight;

        const average: number[] = new TypedArray1d(maxZ, 0);

        for (let x: number = 5; x < maxX - 5; x++) {
            const east = this.floort1[x + 5];
            const west = this.floort1[x - 5];

            for (let z: number = 0; z < maxZ; z++) {
                average[z] += this.floorcol1[east[z]] - this.floorcol1[west[z]];
            }

            if (x > 10 && x < maxX - 10) {
                let r: number = 0;
                let g: number = 0;
                let b: number = 0;

                for (let z: number = 5; z < maxZ - 5; z++) {
                    const north: number = average[z + 5];
                    const south: number = average[z - 5];

                    r += (north >> 20) - (south >> 20);
                    g += ((north >> 10) & 0x3ff) - ((south >> 10) & 0x3ff);
                    b += (north & 0x3ff) - (south & 0x3ff);

                    if (b > 0) {
                        this.blendedGroundColour[x][z] = this.getRgb(r / 8533.0, g / 8533.0, b / 8533.0);
                    }
                }
            }
        }
    }

    // ----

    loadUnderlay(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        this.floort1[mx + x][zIndex--] = data.g1();
                    }
                }
            } else {
                data.pos += 4096;
            }
        }
    }

    loadOverlay(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        const opcode: number = data.g1();
                        if (opcode === 0) {
                            this.floort2[x + mx][zIndex--] = 0;
                        } else {
                            this.floorsr[x + mx][zIndex] = data.g1();
                            this.floort2[x + mx][zIndex--] = this.floorcol2[opcode];
                        }
                    }
                }
            } else {
                for (let i: number = -4096; i < 0; i++) {
                    const opcode: number = data.g1();
                    if (opcode != 0) {
                        data.g1();
                    }
                }
            }
        }
    }

    loadLoc(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        while (true) {
                            const opcode: number = data.g1();
                            if (opcode === 0) {
                                zIndex--;
                                break;
                            }

                            if (opcode < 29) {
                                this.locWall[x + mx][zIndex] = opcode;
                            } else if (opcode < 160) {
                                this.locMapscene[x + mx][zIndex] = opcode - 28;
                            } else {
                                this.locMapfunction[x + mx][zIndex] = opcode - 159;

                                this.activeMapFunctions[this.activeMapFunctionCount] = opcode - 160;
                                this.activeMapFunctionX[this.activeMapFunctionCount] = x + mx;
                                this.activeMapFunctionZ[this.activeMapFunctionCount] = zIndex;
                                this.activeMapFunctionCount++;
                            }
                        }
                    }
                }
            } else {
                for (let x: number = 0; x < 64; x++) {
                    let opcode: number = 0;
                    for (let z: number = -64; z < 0; z++) {
                        do {
                            opcode = data.g1();
                        } while (opcode != 0);
                    }
                }
            }
        }
    }

    // custom:
    loadObj(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        this.objPos[x + mx][zIndex--] = data.g1() == 1;
                    }
                }
            } else {
                data.pos += 4096;
            }
        }
    }

    // custom:
    loadNpc(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        this.npcPos[x + mx][zIndex--] = data.g1() == 1;
                    }
                }
            } else {
                data.pos += 4096;
            }
        }
    }

    // custom:
    loadMulti(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        this.multiPos[x + mx][zIndex--] = data.g1() == 1;
                    }
                }
            } else {
                data.pos += 4096;
            }
        }
    }

    // custom:
    loadFree(data: Packet): void {
        while (data.available > 0) {
            const mx: number = data.g1() * 64 - this.mapOriginX;
            const mz: number = data.g1() * 64 - this.mapOriginZ;

            if (mx > 0 && mz > 0 && mx + 64 < this.mapWidth && mz + 64 < this.mapHeight) {
                for (let x: number = 0; x < 64; x++) {
                    let zIndex: number = this.mapHeight - mz - 1;

                    for (let z: number = -64; z < 0; z++) {
                        this.freePos[x + mx][zIndex--] = data.g1() == 1;
                    }
                }
            } else {
                data.pos += 4096;
            }
        }
    }

    // ----

    // jag::oldscape::rs2lib::worldmap::HslUtils::GetRgb
    getRgb(hue: number, saturation: number, lightness: number): number {
        let r: number = lightness;
        let g: number = lightness;
        let b: number = lightness;

        if (saturation !== 0.0) {
            let q: number;
            if (lightness < 0.5) {
                q = lightness * (saturation + 1.0);
            } else {
                q = lightness + saturation - lightness * saturation;
            }

            const p: number = lightness * 2.0 - q;
            let t: number = hue + 0.3333333333333333;
            if (t > 1.0) {
                t--;
            }

            let d11: number = hue - 0.3333333333333333;
            if (d11 < 0.0) {
                d11++;
            }

            if (t * 6.0 < 1.0) {
                r = p + (q - p) * 6.0 * t;
            } else if (t * 2.0 < 1.0) {
                r = q;
            } else if (t * 3.0 < 2.0) {
                r = p + (q - p) * (0.6666666666666666 - t) * 6.0;
            } else {
                r = p;
            }

            if (hue * 6.0 < 1.0) {
                g = p + (q - p) * 6.0 * hue;
            } else if (hue * 2.0 < 1.0) {
                g = q;
            } else if (hue * 3.0 < 2.0) {
                g = p + (q - p) * (0.6666666666666666 - hue) * 6.0;
            } else {
                g = p;
            }

            if (d11 * 6.0 < 1.0) {
                b = p + (q - p) * 6.0 * d11;
            } else if (d11 * 2.0 < 1.0) {
                b = q;
            } else if (d11 * 3.0 < 2.0) {
                b = p + (q - p) * (0.6666666666666666 - d11) * 6.0;
            } else {
                b = p;
            }
        }

        const intR: number = (r * 256.0) | 0;
        const intG: number = (g * 256.0) | 0;
        const intB: number = (b * 256.0) | 0;
        return (intR << 16) + (intG << 8) + intB;
    }

    // jag::oldscape::worldmap::Worldmap::RenderWorldmap
    renderWorldMap(left: number, top: number, right: number, bottom: number, widthOffset: number, heightOffset: number, width: number, height: number): void {
        const visibleX: number = right - left;
        const visibleY: number = bottom - top;
        const widthRatio: number = (((width - widthOffset) << 16) / visibleX) | 0;
        const heightRatio: number = (((height - heightOffset) << 16) / visibleY) | 0;

        for (let x: number = 0; x < visibleX; x++) {
            let startX: number = (widthRatio * x) >> 16;
            let endX: number = (widthRatio * (x + 1)) >> 16;
            const lengthX: number = endX - startX;
            if (lengthX <= 0) {
                continue;
            }

            startX += widthOffset;
            endX += widthOffset;

            const colours = this.blendedGroundColour[x + left];
            const overlays = this.floort2[x + left];
            const shapes = this.floorsr[x + left];

            for (let y: number = 0; y < visibleY; y++) {
                let startY: number = (heightRatio * y) >> 16;
                let endY: number = (heightRatio * (y + 1)) >> 16;
                const lengthY: number = endY - startY;
                if (lengthY <= 0) {
                    continue;
                }

                startY += heightOffset;
                endY += heightOffset;

                const overlay: number = overlays[y + top];
                if (overlay === 0) {
                    Pix2D.fillRect(startX, startY, endX - startX, endY - startY, colours[y + top]);
                } else {
                    const info: number = shapes[y + top];
                    const shape: number = info & 0xfc;
                    if (shape == 0 || lengthX <= 1 || lengthY <= 1) {
                        Pix2D.fillRect(startX, startY, lengthX, lengthY, overlay);
                    } else {
                        this.drawOverlayShape(Pix2D.pixels, startY * Pix2D.width + startX, colours[y + top], overlay, lengthX, lengthY, shape >> 2, info & 0x3);
                    }
                }
            }
        }

        if (right - left > width - widthOffset) {
            return;
        }

        let visibleMapFunctionCount: number = 0;
        for (let x: number = 0; x < visibleX; x++) {
            let startX: number = (widthRatio * x) >> 16;
            let endX: number = (widthRatio * (x + 1)) >> 16;
            const lengthX: number = endX - startX;
            if (lengthX <= 0) {
                continue;
            }

            const walls = this.locWall[x + left];
            const mapscenes = this.locMapscene[x + left];
            const mapfunctions = this.locMapfunction[x + left];

            for (let y: number = 0; y < visibleY; y++) {
                let startY: number = (heightRatio * y) >> 16;
                let endY: number = (heightRatio * (y + 1)) >> 16;
                const lengthY: number = endY - startY;
                if (lengthY <= 0) {
                    continue;
                }

                let wall: number = walls[y + top] & 0xff;
                if (wall != 0) {
                    let edgeX: number;
                    if (lengthX == 1) {
                        edgeX = startX;
                    } else {
                        edgeX = endX - 1;
                    }

                    let edgeY: number;
                    if (lengthY == 1) {
                        edgeY = startY;
                    } else {
                        edgeY = endY - 1;
                    }

                    let rgb: number = 0xcccccc;
                    if ((wall >= 5 && wall <= 8) || (wall >= 13 && wall <= 16) || (wall >= 21 && wall <= 24)) {
                        rgb = 0xcc0000;
                        wall -= 4;
                    }
                    if (wall == 27 || wall == 28) {
                        // custom: fix drawing diagonal doors
                        rgb = 0xcc0000;
                        wall -= 2;
                    }

                    if (wall == 1) {
                        Pix2D.vline(startX, startY, lengthY, rgb);
                    } else if (wall == 2) {
                        Pix2D.hline(startX, startY, lengthX, rgb);
                    } else if (wall == 3) {
                        Pix2D.vline(edgeX, startY, lengthY, rgb);
                    } else if (wall == 4) {
                        Pix2D.hline(startX, edgeY, lengthX, rgb);
                    } else if (wall == 9) {
                        Pix2D.vline(startX, startY, lengthY, 0xffffff);
                        Pix2D.hline(startX, startY, lengthX, rgb);
                    } else if (wall == 10) {
                        Pix2D.vline(edgeX, startY, lengthY, 0xffffff);
                        Pix2D.hline(startX, startY, lengthX, rgb);
                    } else if (wall == 11) {
                        Pix2D.vline(edgeX, startY, lengthY, 0xffffff);
                        Pix2D.hline(startX, edgeY, lengthX, rgb);
                    } else if (wall == 12) {
                        Pix2D.vline(startX, startY, lengthY, 0xffffff);
                        Pix2D.hline(startX, edgeY, lengthX, rgb);
                    } else if (wall == 17) {
                        Pix2D.hline(startX, startY, 1, rgb);
                    } else if (wall == 18) {
                        Pix2D.hline(edgeX, startY, 1, rgb);
                    } else if (wall == 19) {
                        Pix2D.hline(edgeX, edgeY, 1, rgb);
                    } else if (wall == 20) {
                        Pix2D.hline(startX, edgeY, 1, rgb);
                    } else if (wall == 25) {
                        for (let i: number = 0; i < lengthY; i++) {
                            Pix2D.hline(startX + i, edgeY - i, 1, rgb);
                        }
                    } else if (wall == 26) {
                        for (let i: number = 0; i < lengthY; i++) {
                            Pix2D.hline(startX + i, startY + i, 1, rgb);
                        }
                    }
                }

                const mapscene: number = mapscenes[y + top];
                if (mapscene != 0) {
                    this.mapscene[mapscene - 1].scalePlotSprite(startX - ((lengthX / 2) | 0), startY - ((lengthY / 2) | 0), lengthX * 2, lengthY * 2);
                }

                const mapfunction: number = mapfunctions[y + top];
                if (mapfunction != 0) {
                    this.visibleMapFunctions[visibleMapFunctionCount] = mapfunction - 1;
                    this.visibleMapFunctionsX[visibleMapFunctionCount] = startX + ((lengthX / 2) | 0);
                    this.visibleMapFunctionsY[visibleMapFunctionCount] = startY + ((lengthY / 2) | 0);
                    visibleMapFunctionCount++;
                }
            }
        }

        for (let i: number = 0; i < visibleMapFunctionCount; i++) {
            this.mapfunction[this.visibleMapFunctions[i]].plotSprite(this.visibleMapFunctionsX[i] - 7, this.visibleMapFunctionsY[i] - 7);
        }

        if (MapView.shouldDrawFreemap) {
            for (let x = 0; x < visibleX; x++) {
                let startX = widthRatio * x >> 16;
                let endX = widthRatio * (x + 1) >> 16;
                let lengthX = endX - startX;
                if (lengthX <= 0) {
                    continue;
                }

                startX += widthOffset;
                endX += widthOffset;

                let multi = this.freePos[x + left];
                for (let y = 0; y < visibleY; y++) {
                    let startY = heightRatio * y >> 16;
                    let endY = heightRatio * (y + 1) >> 16;
                    let lengthY = endY - startY;
                    if (lengthY <= 0) {
                        continue;
                    }

                    startY += heightOffset;
                    endY += heightOffset;

                    if (multi[y + top]) {
                        Pix2D.fillRectTrans(startX, startY, lengthX, lengthY, 0x00ff00, 96);
                    }
                }
            }
        }

        if (MapView.shouldDrawMultimap) {
            for (let x = 0; x < visibleX; x++) {
                let startX = widthRatio * x >> 16;
                let endX = widthRatio * (x + 1) >> 16;
                let lengthX = endX - startX;
                if (lengthX <= 0) {
                    continue;
                }

                startX += widthOffset;
                endX += widthOffset;

                let multi = this.multiPos[x + left];
                for (let y = 0; y < visibleY; y++) {
                    let startY = heightRatio * y >> 16;
                    let endY = heightRatio * (y + 1) >> 16;
                    let lengthY = endY - startY;
                    if (lengthY <= 0) {
                        continue;
                    }

                    startY += heightOffset;
                    endY += heightOffset;

                    if (multi[y + top]) {
                        Pix2D.fillRectTrans(startX, startY, lengthX, lengthY, 0xff0000, 96);
                    }
                }
            }
        }

        if (MapView.shouldDrawItems) {
            for (let x: number = 0; x < visibleX; x++) {
                let startX: number = (widthRatio * x) >> 16;
                let endX: number = (widthRatio * (x + 1)) >> 16;
                const lengthX: number = endX - startX;
                if (lengthX <= 0) {
                    continue;
                }

                startX += widthOffset;
                endX += widthOffset;

                for (let y: number = 0; y < visibleY; y++) {
                    let startY: number = (heightRatio * y) >> 16;
                    let endY: number = (heightRatio * (y + 1)) >> 16;
                    const lengthY: number = endY - startY;
                    if (lengthY <= 0) {
                        continue;
                    }

                    startY += heightOffset;
                    endY += heightOffset;

                    if (this.objPos[x + left][y + top]) {
                        this.mapdot0?.plotSprite(startX, startY);
                    }
                }
            }
        }

        if (MapView.shouldDrawNpcs) {
            for (let x: number = 0; x < visibleX; x++) {
                let startX: number = (widthRatio * x) >> 16;
                let endX: number = (widthRatio * (x + 1)) >> 16;
                const lengthX: number = endX - startX;
                if (lengthX <= 0) {
                    continue;
                }

                startX += widthOffset;
                endX += widthOffset;

                for (let y: number = 0; y < visibleY; y++) {
                    let startY: number = (heightRatio * y) >> 16;
                    let endY: number = (heightRatio * (y + 1)) >> 16;
                    const lengthY: number = endY - startY;
                    if (lengthY <= 0) {
                        continue;
                    }

                    startY += heightOffset;
                    endY += heightOffset;

                    if (this.npcPos[x + left][y + top]) {
                        this.mapdot1?.plotSprite(startX, startY);
                    }
                }
            }
        }

        if (this.flashTimer > 0) {
            for (let i: number = 0; i < visibleMapFunctionCount; i++) {
                if (this.visibleMapFunctions[i] == this.currentKey) {
                    this.mapfunction[this.visibleMapFunctions[i]].plotSprite(this.visibleMapFunctionsX[i] - 7, this.visibleMapFunctionsY[i] - 7);

                    if (this.flashTimer % 10 < 5) {
                        Pix2D.fillCircle(this.visibleMapFunctionsX[i], this.visibleMapFunctionsY[i], 15, 0xffff00, 128);
                        Pix2D.fillCircle(this.visibleMapFunctionsX[i], this.visibleMapFunctionsY[i], 7, 0xffffff, 256);
                    }
                }
            }
        }

        if (this.zoom == this.targetZoom && MapView.shouldDrawLabels) {
            for (let i: number = 0; i < this.mapLabelCount; i++) {
                let x = this.mapLabelX[i];
                let y = this.mapLabelY[i];

                x -= this.mapOriginX;
                y = this.mapOriginZ + this.mapHeight - y;

                const drawX: number = (widthOffset + ((width - widthOffset) * (x - left)) / (right - left)) | 0;
                let drawY: number = (heightOffset + ((height - heightOffset) * (y - top)) / (bottom - top)) | 0;
                const labelSize: number = this.mapLabelSize[i];

                let rgb: number = 0xffffff;
                let font: WorldMapFont | null = null;
                if (labelSize == 0) {
                    if (this.zoom == 3.0) {
                        font = this.f11;
                    } else if (this.zoom == 4.0) {
                        font = this.f12;
                    } else if (this.zoom == 6.0) {
                        font = this.f14;
                    } else if (this.zoom == 8.0) {
                        font = this.f17;
                    }
                } else if (labelSize == 1) {
                    if (this.zoom == 3.0) {
                        font = this.f14;
                    } else if (this.zoom == 4.0) {
                        font = this.f17;
                    } else if (this.zoom == 6.0) {
                        font = this.f19;
                    } else if (this.zoom == 8.0) {
                        font = this.f22;
                    }
                } else if (labelSize == 2) {
                    rgb = 0xffaa00;

                    if (this.zoom == 3.0) {
                        font = this.f19;
                    } else if (this.zoom == 4.0) {
                        font = this.f22;
                    } else if (this.zoom == 6.0) {
                        font = this.f26;
                    } else if (this.zoom == 8.0) {
                        font = this.f30;
                    }
                }

                if (font !== null) {
                    let label = this.mapLabel[i];

                    let lineCount = 1;
                    for (let j = 0; j < label.length; j++) {
                        if (label[j] === '/') {
                            lineCount++;
                        }
                    }

                    drawY -= ((font.getHeight() * (lineCount - 1) / 2) | 0);
                    drawY += (font.getYOffset() / 2) | 0;

                    while (true) {
                        const newline = label.indexOf('/');
                        if (newline === -1) {
                            font.centreString(label, drawX, drawY, rgb, true);
                            break;
                        }

                        const part = label.substring(0, newline);
                        font.centreString(part, drawX, drawY, rgb, true);

                        drawY += font.getHeight();
                        label = label.substring(newline + 1);
                    }
                }
            }
        }

        if (MapView.shouldDrawBorders) {
            for (let mx: number = this.mapOriginX / 64; mx < (this.mapOriginX + this.mapWidth) / 64; mx++) {
                for (let mz: number = this.mapOriginZ / 64; mz < (this.mapOriginZ + this.mapHeight) / 64; mz++) {
                    let x: number = mx * 64;
                    let z: number = mz * 64;

                    x -= this.mapOriginX;
                    z = this.mapOriginZ + this.mapHeight - z;

                    const drawLeft: number = (widthOffset + ((width - widthOffset) * (x - left)) / (right - left)) | 0;
                    const drawTop: number = (heightOffset + ((height - heightOffset) * (z - 64 - top)) / (bottom - top)) | 0;
                    const drawRight: number = (widthOffset + ((width - widthOffset) * (x + 64 - left)) / (right - left)) | 0;
                    const drawBottom: number = (heightOffset + ((height - heightOffset) * (z - top)) / (bottom - top)) | 0;

                    if (drawLeft >= width || drawTop >= height || drawRight <= 0 || drawBottom <= 0) {
                        continue;
                    }

                    Pix2D.drawRect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop, 0xffffff);
                    this.b12?.drawStringRight(mx + '_' + mz, drawRight - 5, drawBottom - 5, 0xffffff, false);

                    if (mx == 33 && mz >= 71 && mz <= 73) {
                        this.b12?.centreString('u_pass', ((drawRight + drawLeft) / 2) | 0, ((drawBottom + drawTop) / 2) | 0, 0xff0000);
                    } else if (mx >= 32 && mx <= 34 && mz >= 70 && mz <= 74) {
                        this.b12?.centreString('u_pass', ((drawRight + drawLeft) / 2) | 0, ((drawBottom + drawTop) / 2) | 0, 0xffff00);
                    }
                }
            }
        }
    }

    // jag::oldscape::rs2lib::worldmap::OverlayShapes::DrawOverlayShape
    drawOverlayShape(data: Int32Array, off: number, underlay: number, overlay: number, width: number, height: number, shape: number, rotation: number): void {
        const step: number = Pix2D.width - width;
        if (shape == 9) {
            shape = 1;
            rotation = (rotation + 1) & 0x3;
        } else if (shape == 10) {
            shape = 1;
            rotation = (rotation + 3) & 0x3;
        } else if (shape == 11) {
            shape = 8;
            rotation = (rotation + 3) & 0x3;
        }

        if (shape == 1) {
            if (rotation == 0) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 2) {
            if (rotation == 0) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 3) {
            if (rotation == 0) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 4) {
            if (rotation == 0) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 5) {
            if (rotation == 0) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y >> 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y << 1) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 6) {
            if (rotation == 0) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= ((width / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (y <= ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= ((width / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (y >= ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 7) {
            if (rotation == 0) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x <= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x <= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        } else if (shape == 8) {
            if (rotation == 0) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 1) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = 0; x < width; x++) {
                        if (x >= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 2) {
                for (let y: number = height - 1; y >= 0; y--) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            } else if (rotation == 3) {
                for (let y: number = 0; y < height; y++) {
                    for (let x: number = width - 1; x >= 0; x--) {
                        if (x >= y - ((height / 2) | 0)) {
                            data[off++] = overlay;
                        } else {
                            data[off++] = underlay;
                        }
                    }
                    off += step;
                }
            }
        }
    }

    // custom:
    async reloadMain() {
        if (this.mapArea === 0) {
            return;
        }

        this.mapStartX = 50 << 6;
        this.mapStartZ = 50 << 6;
        this.mapWidth = 25 << 6;
        this.mapHeight = 19 << 6;
        this.mapOriginX = 32 << 6;
        this.mapOriginZ = 44 << 6;
        this.mapArea = 0;
        this.focusX = this.mapStartX - this.mapOriginX;
        this.focusZ = this.mapOriginZ + this.mapHeight - this.mapStartZ;
        this.dragFocusX = -1;
        this.dragFocusZ = -1;
        this.redraw = true;

        Pix2D.cls();
        await this.maininit();
    }

    // custom:
    async reloadDungeon() {
        if (this.mapArea === 1) {
            return;
        }

        this.mapStartX = 50 << 6;
        this.mapStartZ = 150 << 6;
        this.mapWidth = 25 << 6;
        this.mapHeight = 19 << 6;
        this.mapOriginX = 32 << 6;
        this.mapOriginZ = 144 << 6;
        this.mapArea = 1;
        this.focusX = this.mapStartX - this.mapOriginX;
        this.focusZ = this.mapOriginZ + this.mapHeight - this.mapStartZ;
        this.dragFocusX = -1;
        this.dragFocusZ = -1;
        this.redraw = true;

        Pix2D.cls();
        await this.maininit();
    }

    // custom:
    async reloadExtra() {
        if (this.mapArea === 2) {
            return;
        }

        this.mapStartX = 39 << 6;
        this.mapStartZ = 74 << 6;
        this.mapWidth = 21 << 6;
        this.mapHeight = 15 << 6;
        this.mapOriginX = 28 << 6;
        this.mapOriginZ = 65 << 6;
        this.mapArea = 2;
        this.focusX = this.mapStartX - this.mapOriginX;
        this.focusZ = this.mapOriginZ + this.mapHeight - this.mapStartZ;
        this.dragFocusX = -1;
        this.dragFocusZ = -1;
        this.redraw = true;

        await this.maininit();
    }

    // ----

    dragging = false;
    activePointerId: number | null = null;

    override mouseDown(x: number, y: number, e: MouseEvent) {
        this.nextMouseClickX = x;
        this.nextMouseClickY = y;

        this.mouseX = x;
        this.mouseY = y;

        if (e.button === 2) {
            this.nextMouseClickButton = 2;
            this.mouseButton = 2;
        } else {
            this.nextMouseClickButton = 1;
            this.mouseButton = 1;
            canvas.style.cursor = 'grabbing';
            this.dragging = true;
        }

        // e.preventDefault();
    }

    override mouseUp(_x: number, _y: number, e: MouseEvent) {
        this.dragging = false;
        canvas.style.cursor = 'grab';

        this.mouseX = -1;
        this.mouseY = -1;
        this.mouseButton = 0;
        this.nextMouseClickX = -1;
        this.nextMouseClickY = -1;
        this.nextMouseClickButton = 0;

        // e.preventDefault();
    }

    override pointerDown(x: number, y: number, e: PointerEvent) {
        this.idleTimer = performance.now();
        this.mouseX = x;
        this.mouseY = y;
        this.mouseButton = 1;
        this.nextMouseClickX = x;
        this.nextMouseClickY = y;
        this.nextMouseClickButton = 1;
    }

    override pointerUp(_x: number, _y: number, e: PointerEvent) {
        this.mouseX = -1;
        this.mouseY = -1;
        this.mouseButton = 0;
        this.nextMouseClickX = -1;
        this.nextMouseClickY = -1;
        this.nextMouseClickButton = 0;
    }

    override pointerEnter() {
    }

    override pointerLeave() {
    }

    override pointerMove(x: number, y: number, _e: PointerEvent) {
        if (!this.dragging) {
            this.mouseX = x;
            this.mouseY = y;
        }
    }

    override windowMouseUp(e: MouseEvent) {
        this.dragging = false;
        canvas.style.cursor = 'grab';

        this.mouseX = -1;
        this.mouseY = -1;
        this.mouseButton = 0;
        this.nextMouseClickX = -1;
        this.nextMouseClickY = -1;
        this.nextMouseClickButton = 0;
    }

    override windowMouseMove(e: MouseEvent) {
        if (this.dragging) {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) | 0;
            const y = (e.clientY - rect.top) | 0;

            this.mouseX = x;
            this.mouseY = y;
        }
    }
}
