// @lcbuddy/api runtime shim: resolves the ABI the LCBuddy2 client installs at
// globalThis.__lcbuddy (property names are stable — the bot bundle never
// mangles; see ADR-0004 in the LCBuddy2 repo). Scripts bundle this in; it
// only works when the bundle runs inside the bot client.
const SUPPORTED_API_VERSION = 1;

const abi = globalThis.__lcbuddy;
if (!abi) {
    throw new Error('@lcbuddy/api: globalThis.__lcbuddy is missing — this script must be loaded inside the LCBuddy2 bot client (bot.html)');
}
if (abi.apiVersion !== SUPPORTED_API_VERSION) {
    throw new Error(`@lcbuddy/api: client ABI version ${abi.apiVersion} != supported ${SUPPORTED_API_VERSION} — update @lcbuddy/api or the client`);
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
