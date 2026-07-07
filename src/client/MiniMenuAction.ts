export const enum MiniMenuAction {
    _PRIORITY = 2000,

    TGT_LOC = 899, // cast spell on
    OP_LOC1 = 625,
    OP_LOC2 = 721,
    OP_LOC3 = 743,
    OP_LOC4 = 357,
    OP_LOC5 = 1071,
    USEHELD_ONLOC = 810, // use item on

    TGT_NPC = 240, // cast spell on
    OP_NPC1 = 242,
    OP_NPC2 = 209,
    OP_NPC3 = 309,
    OP_NPC4 = 852,
    OP_NPC5 = 793,
    USEHELD_ONNPC = 829, // use item on

    TGT_OBJ = 370, // cast spell on
    OP_OBJ1 = 139,
    OP_OBJ2 = 778,
    OP_OBJ3 = 617,
    OP_OBJ4 = 224,
    OP_OBJ5 = 662,
    USEHELD_ONOBJ = 111, // use item on

    TGT_PLAYER = 131, // cast spell on
    OP_PLAYER1 = 639,
    ACCEPT_DUELREQ = 957, // opplayer1
    OP_PLAYER2 = 499,
    OP_PLAYER3 = 27,
    OP_PLAYER4 = 387,
    ACCEPT_TRADEREQ = 507, // opplayer4
    OP_PLAYER5 = 185,
    USEHELD_ONPLAYER = 275, // use item on

    TGT_HELD = 563, // cast spell on
    OP_HELD1 = 694,
    OP_HELD2 = 962,
    OP_HELD3 = 795,
    OP_HELD4 = 681,
    OP_HELD5 = 100,
    USEHELD_ONHELD = 398, // use item on

    INV_BUTTON1 = 582,
    INV_BUTTON2 = 113,
    INV_BUTTON3 = 555,
    INV_BUTTON4 = 331,
    INV_BUTTON5 = 354,

    WALK = 718,

    IF_BUTTON = 231,
    TGT_BUTTON = 274, // select target for spell
    CLOSE_BUTTON = 737,
    TOGGLE_BUTTON = 435,
    SELECT_BUTTON = 225,
    PAUSE_BUTTON = 997,

    USEHELD_START = 102, // select target for item

    OP_LOC6 = 1381, // examine
    OP_NPC6 = 1714, // examine
    OP_OBJ6 = 1152, // examine
    OP_HELD6 = 1328, // examine

    CANCEL = 1106,

    ABUSE_REPORT = 524,

    FRIENDLIST_ADD = 605,
    IGNORELIST_ADD = 47,
    FRIENDLIST_DEL = 513,
    IGNORELIST_DEL = 884,

    MESSAGE_PRIVATE = 902,
}
