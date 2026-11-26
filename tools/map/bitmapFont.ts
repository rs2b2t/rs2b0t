// One byte per column, with the top pixel in the low bit.
const columns: Record<string, string> = {
    A: '7e0909097e', B: '7f49494936', C: '3e41414122', D: '7f4141221c',
    E: '7f494941', F: '7f090901', G: '3e41495132', H: '7f0808087f',
    I: '417f41', J: '2040413f01', K: '7f08142241', L: '7f404040',
    M: '7f020c027f', N: '7f0408107f', O: '3e4141413e', P: '7f09090906',
    Q: '3e4151215e', R: '7f09192946', S: '2649494932', T: '01017f0101',
    U: '3f4040403f', V: '0f3040300f', W: '7f2018207f', X: '6314081463',
    Y: '0304780403', Z: '6151494543',
    a: '2054545478', b: '7f444438', c: '38444428', d: '3844447f',
    e: '3854545418', f: '087e0901', g: '18a4a4a47c', h: '7f040478',
    i: '7d', j: '80807d', k: '7f102844', l: '3f40',
    m: '7c04780478', n: '7c040478', o: '38444438', p: 'fc242418',
    q: '182424fc', r: '7c080404', s: '48545424', t: '043f4440',
    u: '3c40407c', v: '1c2040201c', w: '3c4030403c', x: '4428102844',
    y: '1ca0a07c', z: '4464544c44',
    '0': '3e4549513e', '1': '427f40', '2': '6251494946', '3': '2241494936',
    '4': '1814127f10', '5': '2745454539', '6': '3e49494930', '7': '0161110907',
    '8': '3649494936', '9': '064949493e', ' ': '0000', '!': '5f', '"': '030003',
    '£': '48487e4942', '$': '244a7f5224', '%': '2313086462', '^': '0402010204',
    '&': '3649552050', '*': '14083e0814', '(': '1c2241', ')': '41221c',
    '-': '080808', '_': '4040404040', '=': '14141414', '+': '08083e0808',
    '[': '7f4141', '{': '083641', ']': '41417f', '}': '413608',
    ';': '8058', ':': '24', "'": '03', '@': '3e415d554e', '#': '147f147f14',
    '~': '0804081008', ',': '8060', '<': '081422', '.': '40', '>': '221408',
    '/': '6010080403', '?': '0201510906', '\\': '0304081060', '|': '7f'
};

export function createBitmapFontContext(width: number, height: number) {
    const pixels = new Uint32Array(width * height);
    return {
        font: '10px sans-serif',
        fillStyle: 'black',
        measureText(char: string) {
            const bits = Buffer.from(columns[char] ?? columns['?'], 'hex');
            const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
            const scale = size / 9;
            const ascent = Math.round(7 * scale);
            return {
                bits, scale,
                width: Math.round((bits.length + 1) * scale),
                actualBoundingBoxAscent: char === ' ' ? 0 : ascent,
                actualBoundingBoxDescent: char === ' ' ? 0 : Math.round(8 * scale) - ascent,
                fontBoundingBoxAscent: ascent,
                fontBoundingBoxDescent: size - ascent
            };
        },
        fillRect(x: number, y: number, w: number, h: number) {
            const color = this.fillStyle === 'white' ? 0xffffffff : 0xff000000;
            for (let row = y; row < y + h; row++) {
                const start = row * width + x;
                pixels.fill(color, start, start + w);
            }
        },
        fillText(char: string, x: number, baseline: number) {
            const glyph = this.measureText(char);
            const top = baseline - glyph.actualBoundingBoxAscent;
            for (let col = 0; col < glyph.bits.length; col++) {
                const left = Math.round(col * glyph.scale);
                const w = Math.round((col + 1) * glyph.scale) - left;
                for (let row = 0; row < 8; row++) {
                    if (glyph.bits[col] & (1 << row)) {
                        const y = Math.round(row * glyph.scale);
                        this.fillRect(x + left, top + y, w, Math.round((row + 1) * glyph.scale) - y);
                    }
                }
            }
        },
        getImageData(x: number, y: number, w: number, h: number) {
            const data = new Uint32Array(w * h);
            for (let row = 0; row < h; row++) {
                const start = (y + row) * width + x;
                data.set(pixels.subarray(start, start + w), row * w);
            }
            return { data: new Uint8ClampedArray(data.buffer), width: w, height: h, colorSpace: 'srgb' };
        }
    };
}
