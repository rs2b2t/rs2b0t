import type { Client } from '#/client/Client.js';

export default class MouseTracking {
    app: Client;
    active: boolean = true;
    length: number = 0;
    x: number[] = new Array(500);
    y: number[] = new Array(500);

    constructor(app: Client) {
        this.app = app;
    }

    cycle() {
        if (this.active) {
            if (this.length < 500) {
                this.x[this.length] = this.app.mouseX;
                this.y[this.length] = this.app.mouseY;
                this.length++;
            }
        }
    }
}
