import Linkable from '#/client/datastruct/Linkable.js';

import GroundDecor from '#/client/dash3d/GroundDecor.js';
import Sprite from '#/client/dash3d/Sprite.js';
import GroundObject from '#/client/dash3d/GroundObject.js';
import Ground from '#/client/dash3d/Ground.js';
import QuickGround from '#/client/dash3d/QuickGround.js';
import Wall from '#/client/dash3d/Wall.js';
import Decor from '#/client/dash3d/Decor.js';

export default class Square extends Linkable {
    level: number;
    readonly x: number;
    readonly z: number;
    readonly originalLevel: number;
    sprites: (Sprite | null)[] | null = null;
    spriteSpan: Int32Array | null = null;

    quickGround: QuickGround | null = null;
    ground: Ground | null = null;
    wall: Wall | null = null;
    decor: Decor | null = null;
    groundDecor: GroundDecor | null = null;
    groundObject: GroundObject | null = null;
    linkedSquare: Square | null = null;
    spriteCount: number = 0;
    spriteSpans: number = 0;
    drawLevel: number = 0;
    drawFront: boolean = false;
    drawBack: boolean = false;
    drawSprites: boolean = false;
    cornerSides: number = 0;
    sidesBeforeCorner: number = 0;
    sidesAfterCorner: number = 0;
    backWallTypes: number = 0;

    constructor(level: number, x: number, z: number) {
        super();
        this.originalLevel = this.level = level;
        this.x = x;
        this.z = z;
    }
}
