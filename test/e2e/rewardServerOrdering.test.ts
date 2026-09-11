import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const engine = resolve(import.meta.dir, '../../../shilo-private/engine');

function methods(file: string, names: readonly string[]): string {
    const source = ts.createSourceFile(file, readFileSync(resolve(engine, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const found = source.statements.filter(ts.isClassDeclaration).flatMap(declaration => declaration.members)
        .filter(ts.isMethodDeclaration).filter(method => names.includes(method.name.getText(source)));
    expect(found).toHaveLength(names.length);
    return found.map(method => method.getText(source)).join('\n');
}

function replay(closeBeforeReward: boolean): unknown {
    const playerMethods = methods('src/engine/entity/Player.ts', [
        'openMainModal', 'closeModal', 'clearComListeners', 'invStopListenOnCom', 'processQueues',
        'canAccess', 'busy', 'containsModalInterface'
    ]);
    const encode = methods('src/engine/entity/NetworkPlayer.ts', ['encodeOut']);
    const closeRequest = methods('src/network/game/client/handler/CloseModalHandler.ts', ['handle']);
    const program = `
        const ModalState = { NONE: 0, MAIN: 1, CHAT: 2, SIDE: 4 };
        const PlayerQueueType = { STRONG: 1 };
        const ServerTriggerType = { IF_CLOSE: 0 };
        const ScriptState = { COUNTDIALOG: 'count', PAUSEBUTTON: 'pause' };
        const World = { shutdown: false };
        const ScriptProvider = { getByTrigger() {} };
        const Component = { get() { return { rootLayer: 6960 }; } };
        const isClientConnected = () => true;
        class IfClose { kind = 'IF_CLOSE'; }
        class IfOpenMain { kind = 'IF_OPENMAIN'; constructor(id) { this.id = id; } }
        class UpdateInvStopTransmit { kind = 'UPDATE_INV_STOPTRANSMIT'; constructor(id) { this.id = id; } }
        class Player {
            modalState = 0; modalMain = -1; modalSide = -1; modalChat = -1;
            lastModalMain = -1; lastModalSide = -1; lastModalChat = -1;
            refreshModal = false; refreshModalClose = false; requestModalClose = false;
            overlay = -1; lastOverlay = -1; activeScript = null; invListeners = []; delayed = false; protect = false;
            queue = { all: () => [] }; weakQueue = { clear() {} }; packets = [];
            write(packet) { this.packets.push(packet); }
            processQueue() {} processWeakQueue() {}
            ${playerMethods}
            ${encode}
        }
        class CloseRequest { ${closeRequest} }
        const player = new Player();
        new CloseRequest().handle({}, player);
        if (${closeBeforeReward}) player.processQueues();
        player.invListeners.push({ com: 6963, type: 141, source: 1, firstSeen: true });
        player.openMainModal(6960);
        player.processQueues();
        const listenersAtUpdateInvs = player.invListeners.map(listener => listener.com);
        player.encodeOut();
        ({ modal: player.modalMain, listenersAtUpdateInvs, deliveryEligible: player.canAccess(), packets: player.packets });
    `;
    return runInNewContext(ts.transpile(program), {}, { timeout: 1000 });
}

test('deferred CLOSE_MODAL removes the reward listener before updateInvs when casket Open shares its input batch', () => {
    expect(replay(false)).toEqual({
        modal: -1, listenersAtUpdateInvs: [], deliveryEligible: true,
        packets: [{ kind: 'UPDATE_INV_STOPTRANSMIT', id: 6963 }, { kind: 'IF_CLOSE' }]
    });
});

test('reward UI survives when the server processes the earlier close before casket Open', () => {
    expect(replay(true)).toEqual({
        modal: 6960, listenersAtUpdateInvs: [6963], deliveryEligible: false, packets: [{ kind: 'IF_OPENMAIN', id: 6960 }]
    });
});
