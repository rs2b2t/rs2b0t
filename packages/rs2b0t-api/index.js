// @rs2b0t/api runtime shim: resolves the ABI the rs2b0t client installs at
// globalThis.__rs2b0t (property names are stable — the bot bundle never
// mangles; see ADR-0004 in the rs2b0t repo). Scripts bundle this in; it
// only works when the bundle runs inside the bot client.
const SUPPORTED_API_VERSION = 1;

const abi = globalThis.__rs2b0t;
if (!abi) {
    throw new Error('@rs2b0t/api: globalThis.__rs2b0t is missing — this script must be loaded inside the rs2b0t bot client (bot.html)');
}
if (abi.apiVersion !== SUPPORTED_API_VERSION) {
    throw new Error(`@rs2b0t/api: client ABI version ${abi.apiVersion} != supported ${SUPPORTED_API_VERSION} — update @rs2b0t/api or the client`);
}

export const {
    apiVersion,
    Execution,
    defineBot,
    registerScript,
    events,
    Game,
    Tile,
    Area,
    Traversal,
    DirectNavigator,
    Npcs,
    Players,
    Locs,
    GroundItems,
    EntityQuery,
    Npc,
    Player,
    Loc,
    GroundItem,
    Inventory,
    InvItem,
    Equipment,
    Bank,
    Skills,
    ChatDialog,
    AbstractBot,
    LoopingBot,
    TaskBot,
    TreeBot,
    BranchTask,
    LeafTask,
    reader
} = abi;
