/**
 * Crossings that need more than a plain `Open` — a precondition (e.g. a toll
 * fee) and/or a dialogue. Keyed by the loc's own coord + level. WalkExecutor
 * consults this table when it reaches an annotated crossing; a match diverts to
 * the conditional-crossing handler. doors.json still routes through these coords
 * as ordinary door edges, so the pathfinder can use them when the precondition
 * is met and avoid them (repath) when it isn't.
 *
 * This is the curated home for the nav audit's findings — add a row per special
 * gate rather than editing the generated doors.json.
 */
export interface SpecialCrossing {
    x: number;
    z: number;
    level: number;
    /** Loc name + interact op that starts the crossing (matches doors.json). */
    locName: string;
    action: string;
    /** Inventory requirement to attempt the crossing at all. */
    requires?: { item: string; count: number };
    /** Dialogue option text(s) to click while driving the conversation. */
    dialogue?: { choose: string[] };
    /** If set, this crossing is driven by talking an NPC (a ship), not a loc
     *  interact: the WalkExecutor OPNPCs this display name, pays the `requires`
     *  fare through `dialogue`, and waits to land on `toTile`. */
    npc?: string;
    /** Teleport-arrival tile (the boat deck for ships). Success = standing here,
     *  NOT `isOnFarSide` — a ship telejump lands you on a fresh L1 deck tile
     *  nowhere near the approach, so proximity to this tile is the arrival test. */
    toTile?: { x: number; z: number; level: number };
    /** For a gate whose FIRST Open runs a one-time prerequisite dialogue that does
     *  NOT move you, and which then needs a SECOND Open to actually cross (the
     *  Gnome Stronghold gate → Femi's "lift these boxes"). The handler drives the
     *  dialogue, then re-Opens the gate and waits for the crossing. Unset gates
     *  (toll gate) cross in the single Open that pays the fare. */
    reopenAfterDialogue?: boolean;
    /** Human label for logs. */
    label: string;
}

export const SPECIAL_CROSSINGS: SpecialCrossing[] = [
    // Al Kharid toll gate (border_gate_toll_left/right). Opening starts a
    // Border-guard dialogue; "Yes, ok." pays 10 coins and teleports you across.
    { x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },
    { x: 3268, z: 3228, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },

    // Port Sarim <-> Musa Point (Karamja) ship. NPC-driven: talk the sailor /
    // customs officer, pay 30 coins through the dialogue, and the engine
    // p_telejumps you onto a LEVEL-1 boat deck at the far port; a 'Gangplank'
    // transport edge (transports.json) then drops you to the L0 dock.
    //
    // KEYED AT THE DECK LEVEL (1), NOT the L0 dock. The trigger in WalkExecutor is
    // specialCrossingAt(transport.locX, transport.locZ, step.level), and for the
    // ship transport edge step.level is the edge's to-tile level = the deck (1).
    // The x,z stay the dock stand tile (= the edge's from = transport.locX/locZ),
    // which also matches the walkTo pre-avoid (keyed on x,z only). See RT1 brief.
    { x: 3027, z: 3218, level: 1, npc: 'Seaman Thresnor', locName: 'Seaman Thresnor', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2956, z: 3143, level: 1 }, label: 'Port Sarim->Musa ship' },
    { x: 2955, z: 3146, level: 1, npc: 'Customs officer', locName: 'Customs officer', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] }, toTile: { x: 3032, z: 3217, level: 1 }, label: 'Musa->Port Sarim ship' },

    // Gnome Stronghold entrance gate (gnome_areagate, name "Gate", a 5x2 blocking
    // centrepiece). The middle passage is x=2461; entering is south (2461,3382) ->
    // north (2461,3385). The FIRST Open from the south with %femi_help=0 and Femi
    // within 6 tiles diverts to her "Could you help me lift these boxes?" dialogue
    // (@grandtree_femi_boxes is a goto — the gate-open code never runs that click).
    // Either reply sets %femi_help; a SECOND Open then force-moves you through, so
    // reopenAfterDialogue. We pick "OK then" (help her) — it costs nothing, whereas
    // declining makes Femi charge 1000gp to sneak you in later during the Grand
    // Tree quest. No fare. Keyed at the south approach = the enter edge's from-tile
    // (transports.json); leaving (north->south) is a plain Open via crossMultiTileDoor.
    { x: 2461, z: 3382, level: 0, locName: 'Gate', action: 'Open', dialogue: { choose: ['OK then'] }, reopenAfterDialogue: true, label: 'Gnome Stronghold gate (Femi boxes)' }
];

/** The special crossing whose loc sits exactly on (x,z,level), or null. */
export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}

/** First `options` entry containing (case-insensitive) any `choose` term, or null. */
export function pickChoice(options: string[], choose: string[]): string | null {
    const wants = choose.map(c => c.toLowerCase());
    return options.find(o => wants.some(w => o.toLowerCase().includes(w))) ?? null;
}

/** True when there is no requirement, or `have` meets the required count. */
export function meetsRequirement(have: number, requires?: { item: string; count: number }): boolean {
    return !requires || have >= requires.count;
}
