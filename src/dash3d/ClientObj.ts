import ObjType from '#/config/ObjType.js';
import type Model from '#/dash3d/Model.js';
import ModelSource from '#/dash3d/ModelSource.js';

export default class ClientObj extends ModelSource {
    readonly id: number;
    count: number;

    constructor(id: number, count: number) {
        super();
        this.id = id;
        this.count = count;
    }

    override getTempModel(): Model | null {
        const obj = ObjType.list(this.id);
        return obj.getModelLit(this.count);
    }
}
