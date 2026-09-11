import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({
    playMidi: (): void => {},
    setMidiVolume: (): void => {},
    stopMidi: (): void => {}
}));

const { default: IfType } = await import('#/client/config/IfType.js');
const { default: NpcType } = await import('#/client/config/NpcType.js');
const { default: ObjType } = await import('#/client/config/ObjType.js');
const { default: ClientPlayer } = await import('#/client/dash3d/ClientPlayer.js');
const { default: Model } = await import('#/client/dash3d/Model.js');
const { default: Packet } = await import('#/client/io/Packet.js');
const { ServerProt } = await import('#/client/io/ServerProt.js');
const { Client } = await import('#/client/shell/Client.js');

function transformedPlayer(npcId = 1487) {
    const player = new ClientPlayer();
    player.ready = true;
    player.appearance[0] = 65535;
    player.transmog = new NpcType();
    player.transmog.id = npcId;
    player.transmog.head = Uint16Array.of(npcId);
    return player;
}

async function setPlayerHead(player: InstanceType<typeof ClientPlayer>, comId: number) {
    const bytes = Uint8Array.of(ServerProt.IF_SETPLAYERHEAD, comId >> 8, comId & 255);
    let offset = 0;
    const client = Object.assign(Object.create(Client.prototype), {
        localPlayer: player,
        in: new Packet(new Uint8Array(16)),
        ptype: -1,
        randomIn: null,
        stream: {
            get available() { return bytes.length - offset; },
            async readBytes(dst: Uint8Array, start: number, count: number) {
                dst.set(bytes.subarray(offset, offset + count), start);
                offset += count;
            }
        }
    }) as InstanceType<typeof Client>;
    expect(await client['tcpIn']()).toBe(true);
}

describe('player dialogue heads', () => {
    const originalInterfaces = IfType.list;

    beforeEach(() => {
        IfType.list = [];
        IfType.modelCache.clear();
        spyOn(ObjType, 'list').mockImplementation(id => {
            throw new Error(`appearance marker reached item lookup: ${id}`);
        });
    });

    afterEach(() => {
        mock.restore();
        IfType.list = originalInterfaces;
        IfType.modelCache.clear();
    });

    test('renders the monkey head when the appearance starts with the transformation marker', () => {
        const player = transformedPlayer();
        const head = new Model();
        spyOn(Model, 'requestDownload').mockReturnValue(true);
        spyOn(Model, 'load').mockImplementation(id => id === 1487 ? head : null);

        expect(player.getHeadModel()).toBe(head);
    });

    test('waits for a transformed head to download', () => {
        spyOn(Model, 'requestDownload').mockReturnValue(false);

        expect(transformedPlayer().getHeadModel()).toBeNull();
    });

    test('keeps a transformation without a chathead blank', () => {
        const player = transformedPlayer();
        player.transmog!.head = null;

        expect(player.getHeadModel()).toBeNull();
    });

    test('does not build a head before appearance is ready', () => {
        const player = transformedPlayer();
        player.ready = false;

        expect(player.getHeadModel()).toBeNull();
    });

    test('changes the cached dialogue head when the monkey form changes', async () => {
        const normal = new Model();
        const ninja = new Model();
        spyOn(Model, 'requestDownload').mockReturnValue(true);
        spyOn(Model, 'load').mockImplementation(id => id === 1487 ? normal : id === 1480 ? ninja : null);
        const com = IfType.list[0] = new IfType();
        const player = transformedPlayer();

        await setPlayerHead(player, 0);
        expect(com.getTempModel(-1, -1, false, player)).toBe(normal);

        player.transmog!.id = 1480;
        player.transmog!.head = Uint16Array.of(1480);
        await setPlayerHead(player, 0);
        expect(com.getTempModel(-1, -1, false, player)).toBe(ninja);
    });

    test('restores the human head after the transformation ends', async () => {
        const monkey = new Model();
        spyOn(Model, 'requestDownload').mockReturnValue(true);
        spyOn(Model, 'load').mockReturnValue(monkey);
        const com = IfType.list[0] = new IfType();
        const player = transformedPlayer();

        await setPlayerHead(player, 0);
        expect(com.getTempModel(-1, -1, false, player)).toBe(monkey);

        player.transmog = null;
        player.appearance.fill(0);
        await setPlayerHead(player, 0);
        const human = com.getTempModel(-1, -1, false, player);
        expect(human).toBeInstanceOf(Model);
        expect(human).not.toBe(monkey);
    });
});
