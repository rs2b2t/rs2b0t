import Linkable2 from '#/datastruct/Linkable2.js';

export default class OnDemandRequest extends Linkable2 {
    archive: number = 0;
    file: number = 0;
    data: Uint8Array | null = null;
    cycle: number = 0;
    urgent: boolean = true;
}
