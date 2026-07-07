import ModelSource from '#/dash3d/ModelSource.js';

export default class Decor {
    readonly y: number;
    x: number;
    z: number;
    readonly wshape: number;
    readonly angle: number;
    model: ModelSource;
    readonly typecode: number;
    readonly typecode2: number;

    constructor(y: number, x: number, z: number, wshape: number, angle: number, model: ModelSource, typecode: number, info: number) {
        this.y = y;
        this.x = x;
        this.z = z;
        this.wshape = wshape;
        this.angle = angle;
        this.model = model;
        this.typecode = typecode;
        this.typecode2 = info;
    }
}
