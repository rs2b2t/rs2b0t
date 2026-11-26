import AnimBase, { AnimTransform } from '#/client/dash3d/AnimBase.js';

import Packet from '#/client/io/Packet.js';

export default class AnimFrame {
    static list: AnimFrame[] = [];
    static opaque: boolean[] = [];

    delay: number = -1;
    base: AnimBase | null = null;

    constructor(readonly transforms = new Int16Array(0)) {}

    get size(): number {
        return this.transforms.length / 4;
    }

    static init(total: number) {
        this.list = new Array(total + 1);
        this.opaque = new Array(total + 1);
        for (let i = 0; i < total + 1; i++) {
            this.opaque[i] = true;
        }
    }

    static unpack(data: Uint8Array) {
        const buf = new Packet(data);
        buf.pos = data.length - 8;

        const headLength = buf.g2();
        const tran1Length = buf.g2();
        const tran2Length = buf.g2();
        const delLength = buf.g2();
        let pos = 0;

        const head = new Packet(data);
        head.pos = pos;
        pos += headLength + 2;

        const tran1 = new Packet(data);
        tran1.pos = pos;
        pos += tran1Length;

        const tran2 = new Packet(data);
        tran2.pos = pos;
        pos += tran2Length;

        const del = new Packet(data);
        del.pos = pos;
        pos += delLength;

        const baseBuf = new Packet(data);
        baseBuf.pos = pos;
        const base = new AnimBase(baseBuf);

        const total = head.g2();
        const scratch = new Int16Array(255 * 4);

        for (let i = 0; i < total; i++) {
            const id = head.g2();
            const groupCount = head.g1();
            let lastGroup = -1;
            let end = 0;

            for (let j = 0; j < groupCount; j++) {
                if (!base.type) {
                    throw new Error();
                }

                const flags = tran1.g1();
                if (flags === 0) continue;

                const type = base.type[j];
                if (type !== AnimTransform.ORIGIN) {
                    for (let group = j - 1; group > lastGroup; group--) {
                        if (base.type[group] === AnimTransform.ORIGIN) {
                            scratch[end++] = group;
                            scratch[end++] = 0;
                            scratch[end++] = 0;
                            scratch[end++] = 0;
                            break;
                        }
                    }
                }

                const defaultValue = type === AnimTransform.SCALE ? 128 : 0;
                scratch[end++] = j;
                scratch[end++] = flags & 1 ? tran2.gsmarts() : defaultValue;
                scratch[end++] = flags & 2 ? tran2.gsmarts() : defaultValue;
                scratch[end++] = flags & 4 ? tran2.gsmarts() : defaultValue;
                lastGroup = j;

                if (type === AnimTransform.TRANSPARENCY) {
                    this.opaque[id] = false;
                }
            }

            const frame = (this.list[id] = new AnimFrame(scratch.slice(0, end)));
            frame.delay = del.g1();
            frame.base = base;
        }
    }

    static get(id: number) {
        return AnimFrame.list[id];
    }

    static animateTransparencies(frame: number) {
        return frame === -1;
    }
}
