export default class QuickGround {
    readonly colourSW: number;
    readonly colourSE: number;
    readonly colourNE: number;
    readonly colourNW: number;
    readonly texture: number;
    readonly minimapRgb: number;
    readonly flat: boolean;

    constructor(
        colourSW: number, colourSE: number, colourNE: number, colourNW: number,
        texture: number,
        minimapRgb: number,
        flat: boolean
    ) {
        this.colourSW = colourSW;
        this.colourSE = colourSE;
        this.colourNE = colourNE;
        this.colourNW = colourNW;
        this.texture = texture;
        this.minimapRgb = minimapRgb;
        this.flat = flat;
    }
}
