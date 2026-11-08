import { Client } from '#/client/shell/Client.js';

import LocType from '#/client/config/LocType.js';
import { resolveMultiloc } from '#/client/config/resolveMultiloc.js';
import SeqType from '#/client/config/SeqType.js';

import type Model from '#/client/dash3d/Model.js';
import ModelSource from '#/client/dash3d/ModelSource.js';

export default class ClientLocAnim extends ModelSource {
    static app: Client;
    readonly index: number;
    readonly shape: number;
    readonly angle: number;
    readonly heightSW: number;
    readonly heightSE: number;
    readonly heightNE: number;
    readonly heightNW: number;
    anim: SeqType | null;
    animFrame: number;
    animCycle: number;

    constructor(index: number, shape: number, angle: number, heightSW: number, heightSE: number, heightNE: number, heightNW: number, seq: number, randomFrame: boolean) {
        super();

        this.index = index;
        this.shape = shape;
        this.angle = angle;

        this.heightSW = heightSW;
        this.heightSE = heightSE;
        this.heightNE = heightNE;
        this.heightNW = heightNW;

        this.anim = seq === -1 ? null : SeqType.list[seq];
        this.animFrame = 0;
        this.animCycle = Client.loopCycle;

        if (randomFrame && this.anim && this.anim.loops !== -1) {
            this.animFrame = (Math.random() * this.anim.numFrames) | 0;
            this.animCycle -= (Math.random() * this.anim.getDelay(this.animFrame)) | 0;
        }
    }

    override getTempModel(): Model | null {
        if (this.anim) {
            let delta = Client.loopCycle - this.animCycle;
            if (delta > 100 && this.anim.loops > 0) {
                delta = 100;
            }

            while (delta > this.anim.getDelay(this.animFrame)) {
                delta -= this.anim.getDelay((this.animFrame));
                this.animFrame++;

                if (this.animFrame < this.anim.numFrames) {
                    continue;
                }

                this.animFrame -= this.anim.loops;

                if (this.animFrame < 0 || this.animFrame >= this.anim.numFrames) {
                    this.anim = null;
                    break;
                }
            }

            this.animCycle = Client.loopCycle - delta;
        }

        let frame = -1;
        if (this.anim && this.anim.frames && typeof this.anim.frames[this.animFrame] !== 'undefined') {
            frame = this.anim.frames[this.animFrame];
        }

        const loc = resolveMultiloc(LocType.list(this.index), ClientLocAnim.app?.var ?? []);
        if (!loc) {
            return null;
        }
        return loc.getModel(this.shape, this.angle, this.heightSW, this.heightSE, this.heightNE, this.heightNW, frame);
    }
}
