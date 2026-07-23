export interface SpecialCrossing {
    x: number;
    z: number;
    level: number;
    locName: string;
    action: string;
    requires?: { item: string; count: number };
    dialogue?: { choose: string[] };
    npc?: string;
    toTile?: { x: number; z: number; level: number };
    reopenAfterDialogue?: boolean;
    label: string;
}

export const SPECIAL_CROSSINGS: SpecialCrossing[] = [
    { x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },
    { x: 3268, z: 3228, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },

    { x: 3027, z: 3218, level: 1, npc: 'Seaman Thresnor', locName: 'Seaman Thresnor', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2956, z: 3143, level: 1 }, label: 'Port Sarim->Musa ship' },
    { x: 2955, z: 3146, level: 1, npc: 'Customs officer', locName: 'Customs officer', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] }, toTile: { x: 3032, z: 3217, level: 1 }, label: 'Musa->Port Sarim ship' },

    { x: 2683, z: 3272, level: 1, npc: 'Captain Barnaby', locName: 'Captain Barnaby', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Yes please.'] }, toTile: { x: 2775, z: 3234, level: 1 }, label: 'Ardougne->Brimhaven ship' },
    { x: 2772, z: 3234, level: 1, npc: 'Customs officer', locName: 'Customs officer', action: 'Pay-fare', requires: { item: 'Coins', count: 30 }, dialogue: { choose: ['Can I journey on this ship?', 'Search away, I have nothing to hide.', 'Ok.'] }, toTile: { x: 2683, z: 3268, level: 1 }, label: 'Brimhaven->Ardougne ship' },

    { x: 2461, z: 3382, level: 0, locName: 'Gate', action: 'Open', dialogue: { choose: ['OK then'] }, reopenAfterDialogue: true, label: 'Gnome Stronghold gate (Femi boxes)' }
];

export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}

export function pickChoice(options: string[], choose: string[]): string | null {
    const wants = choose.map(c => c.toLowerCase());
    return options.find(o => wants.some(w => o.toLowerCase().includes(w))) ?? null;
}

export function meetsRequirement(have: number, requires?: { item: string; count: number }): boolean {
    return !requires || have >= requires.count;
}
