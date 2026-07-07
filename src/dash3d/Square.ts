import Linkable from '#/datastruct/Linkable.js';

import GroundDecor from '#/dash3d/GroundDecor.js';
import Sprite from '#/dash3d/Sprite.js';
import GroundObject from '#/dash3d/GroundObject.js';
import Ground from '#/dash3d/Ground.js';
import QuickGround from '#/dash3d/QuickGround.js';
import Wall from '#/dash3d/Wall.js';
import Decor from '#/dash3d/Decor.js';

import { TypedArray1d } from '#/util/Arrays.js';

export default class Square extends Linkable {
    level: number;
    readonly x: number;
    readonly z: number;
    readonly originalLevel: number;
    readonly sprites: (Sprite | null)[] = new TypedArray1d(5, null);
    readonly spriteSpan: Int32Array = new Int32Array(5);

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
