export const enum CollisionFlag {
    _OPEN = 0,

    W_NW = 0x1,
    W_N = 0x2,
    W_NE = 0x4,
    W_E = 0x8,
    W_SE = 0x10,
    W_S = 0x20,
    W_SW = 0x40,
    W_W = 0x80,
    WALK_BLOCK_FLAGS = 0xFF,
    WALK_SCENERY = 0x100,

    V_NW = 0x200,
    V_N = 0x400,
    V_NE = 0x800,
    V_E = 0x1000,
    V_SE = 0x2000,
    V_S = 0x4000,
    V_SW = 0x8000,
    V_W = 0x10000,
    VIS_BLOCK_FLAGS = 0x1FE00,
    VIS_SCENERY = 0x20000,

    WR_GROUND_DECOR = 0x40000,
    BLOCK_NPCS_AND_PLAYERS = 0x80000,
    ROOF = 0x100000,
    WR_GRND = 0x200000,

    SQ_BLOCKED = 0x280100,
    PL_WALK_N = 0x280102,
    PL_WALK_E = 0x280108,
    PL_WALK_NE = 0x28010E,
    PL_WALK_S = 0x280120,
    PL_WALK_SE = 0x280138,
    PL_WALK_W = 0x280180,
    PL_WALK_NW = 0x280183,
    PL_WALK_SW = 0x2801E0,

    MULTIWAY = 0x400000,
    FREEMAP = 0x800000,
    UNLOADED = 0x1000000,
    NPCS_OR_PLAYERS = 0x2000000,

    _BOUNDS = 0xFFFFFF
}
