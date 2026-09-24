import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { Client } = await import('#/client/shell/Client.js');
const { default: ClientLocAnim } = await import('#/client/dash3d/ClientLocAnim.js');
const { default: ClientBuild } = await import('#/client/shell/ClientBuild.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { default: VarBitType } = await import('#/client/config/VarBitType.js');
const { default: Model } = await import('#/client/dash3d/Model.js');
const { BotHost } = await import('#/bot/runtime/BotHost.js');
const { ServerProt } = await import('#/client/io/ServerProt.js');
const { attach, detach, invalidateLocSnapshots, reader } = await import('#/bot/adapter/ClientAdapter.js');

type Loc = InstanceType<typeof LocType>;
const rawId = 5;
const transformedId = 9;
const typecode = (2 << 29) | (rawId << 14) | (2 << 7) | 1;
const locs = new Map<number, Loc>();
const origList = LocType.list;
const origVarbits = VarBitType.list;
const origPickedCount = Model.pickedCount;
const origLowMem = ClientBuild.lowMem;

function loc(id: number, name: string, op: string[], multiloc: number[] = []): Loc {
    const result = Object.create(LocType.prototype) as Loc;
    result.id = id;
    result.name = name;
    result.op = [op[0], null, null, null, null];
    result.multivarbit = multiloc.length ? 0 : -1;
    result.multiloc = multiloc;
    result.anim = -1;
    result.getModel = () => ({ id }) as never;
    return result;
}

function scene(varValue: number) {
    return {
        world: {
            wallType: () => 0,
            sceneType: (_level: number, x: number, z: number) => x === 1 && z === 2 ? typecode : 0,
            gdType: () => 0,
            decorType: () => 0,
            typeCode2: () => 0
        },
        localPlayer: { x: 0, z: 0 },
        minusedlevel: 0,
        mapBuildBaseX: 3200,
        mapBuildBaseZ: 3200,
        var: [varValue]
    };
}

beforeEach(() => {
    locs.set(rawId, loc(rawId, 'Raw door', ['Open'], [transformedId, -1]));
    locs.set(transformedId, loc(transformedId, 'Secret passage', ['Enter']));
    LocType.list = (id: number) => locs.get(id)!;
    VarBitType.list = [{ basevar: 0, startbit: 1, endbit: 3 } as InstanceType<typeof VarBitType>];
    invalidateLocSnapshots();
});

afterEach(() => {
    detach();
    invalidateLocSnapshots();
});

afterAll(() => {
    LocType.list = origList;
    VarBitType.list = origVarbits;
    Model.pickedCount = origPickedCount;
    ClientBuild.lowMem = origLowMem;
});

function menu(varValue: number): { menuOption: string[]; menuNumEntries: number; menuParamA: Int32Array } {
    const client = Object.assign(Object.create(Client.prototype), scene(varValue), {
        useMode: 0,
        targetMode: 0,
        menuOption: [] as string[],
        menuAction: new Int32Array(20),
        menuParamA: new Int32Array(20),
        menuParamB: new Int32Array(20),
        menuParamC: new Int32Array(20),
        menuNumEntries: 0
    });
    Model.pickedCount = 1;
    Model.pickedEntityTypecode[0] = typecode;
    client.addWorldOptions();
    return client;
}

describe('multiloc placement', () => {
    test('menu uses the visible child but retains the placement typecode', () => {
        const result = menu(0);
        expect(result.menuOption).toContain('Enter @cya@Secret passage');
        expect(result.menuOption).not.toContain('Open @cya@Raw door');
        expect(result.menuParamA[1]).toBe(typecode);
    });

    test('hidden child has no menu or snapshot entry', () => {
        expect(menu(2).menuOption).toEqual(['Walk here']);
        attach(scene(2) as never);
        expect(reader.locs()).toEqual([]);
    });

    test('snapshot exposes visible child actions but preserves placement id', () => {
        attach(scene(0) as never);
        expect(reader.locs()[0]).toMatchObject({ id: rawId, typecode, name: 'Secret passage' });
        expect(reader.locs()[0].ops[0]).toBe('Enter');
    });

    test('nonanimated multiloc renders selected child and disappears for hidden child', () => {
        ClientLocAnim.app = { var: [0] } as InstanceType<typeof Client>;
        const model = new ClientLocAnim(rawId, 10, 0, 0, 0, 0, 0, -1, true);
        expect((model.getTempModel() as unknown as { id: number }).id).toBe(transformedId);
        ClientLocAnim.app.var[0] = 2;
        expect(model.getTempModel()).toBeNull();
    });

    test.each([ServerProt.VARP_SMALL, ServerProt.VARP_LARGE, ServerProt.VARP_SYNC])('varp packet %i refreshes cached snapshot', ptype => {
        const client = scene(0);
        attach(client as never);
        expect(reader.locs()[0].name).toBe('Secret passage');
        client.var[0] = 2;
        (BotHost as unknown as { handlePacket(ptype: number): void }).handlePacket(ptype);
        expect(reader.locs()).toEqual([]);
    });

    test('out of range transform state hides placement', () => {
        expect(menu(4).menuOption).toEqual(['Walk here']);
    });

    test('scene builder gives a static multiloc a dynamic model', () => {
        ClientBuild.lowMem = false;
        const builder = Object.assign(Object.create(ClientBuild.prototype), {
            groundh: [[Int32Array.of(0, 0), Int32Array.of(0, 0)]]
        });
        let built: unknown;
        const world = { setGroundDecor: (model: unknown) => { built = model; } };
        builder.addLoc(0, 0, 0, rawId, 22, 0, world, null);
        expect(built).toBeInstanceOf(ClientLocAnim);
    });

    test('ordinary loc keeps its own menu and snapshot definition', () => {
        locs.set(rawId, loc(rawId, 'Raw door', ['Open']));
        expect(menu(0).menuOption).toContain('Open @cya@Raw door');
        attach(scene(0) as never);
        expect(reader.locs()[0]).toMatchObject({ id: rawId, typecode, name: 'Raw door' });
    });

    test('ordinary loc with no transform still renders', () => {
        const model = new ClientLocAnim(transformedId, 10, 0, 0, 0, 0, 0, -1, true);
        expect((model.getTempModel() as unknown as { id: number }).id).toBe(transformedId);
    });
});
