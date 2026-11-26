import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';

export default class SpriteSheet {
    readonly dat: Packet;
    private readonly index: Packet;
    readonly owi: number;
    readonly ohi: number;
    readonly palette: Int32Array;

    constructor(jag: JagFile, name: string, black: 0 | 1, sprite = 0) {
        const dat = this.dat = new Packet(jag.read(name + '.dat'));
        const index = this.index = new Packet(jag.read('index.dat'));
        index.pos = dat.g2();
        this.owi = index.g2();
        this.ohi = index.g2();
        this.palette = new Int32Array(index.g1());
        for (let i = 1; i < this.palette.length; i++) {
            this.palette[i] = index.g3() || black;
        }
        for (let i = 0; i < sprite; i++) {
            index.pos += 2;
            dat.pos += index.g2() * index.g2();
            index.pos++;
        }
    }

    readFrameHeader() {
        const { dat, index } = this;
        if (dat.pos > dat.length || index.pos > index.length) {
            throw new Error();
        }
        const xof = index.g1();
        const yof = index.g1();
        const wi = index.g2();
        const hi = index.g2();
        const encoding = index.g1();
        if (encoding !== 0 && encoding !== 1) dat.pos += wi * hi;
        return { xof, yof, wi, hi, encoding };
    }
}
