import { MELEE_WEAPONS } from './equipment.js';

const TIER_ATTACK: Record<string, number> = { bronze: 1, iron: 1, steel: 5, black: 10, mithril: 20, adamant: 30, rune: 40, dragon: 60 };
const TIER_RANK: string[] = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune', 'dragon'];

// Why: the pack's own rolls put the longsword's stab first against stab defence 50, the metal dragons' soft side, while a scimitar's four-tick slash is the pick everywhere else.
const STAB_ORDER: string[] = ['longsword', 'battleaxe', 'dagger', 'sword', 'scimitar', 'mace'];
const SLASH_ORDER: string[] = ['scimitar', 'sword', 'longsword', 'dagger', 'battleaxe', 'mace'];

function tierOf(name: string): string {
    return name.split(' ')[0]!.toLowerCase();
}

function typeOf(name: string): string {
    return name.split(' ').slice(1).join(' ').toLowerCase().replace(/\(p\)$/, '');
}

export interface WeaponPick {
    /** The character's Attack level. */
    attack: number;
    /** Rank stab weapons first, for a target soft to stab. */
    preferStab: boolean;
    /** Names a wield already refused, a level or a quest short. */
    unusable?: ReadonlySet<string>;
}

/** The best melee weapon among `available` the character can wield, or null. */
export function bestMeleeWeapon(available: readonly string[], pick: WeaponPick): string | null {
    const order = pick.preferStab ? STAB_ORDER : SLASH_ORDER;
    const have = new Set(available.map(n => n.toLowerCase()));
    const usable = MELEE_WEAPONS.filter(name => have.has(name.toLowerCase()))
        .filter(name => !(pick.unusable?.has(name) ?? false))
        .filter(name => (TIER_ATTACK[tierOf(name)] ?? 1) <= pick.attack);
    usable.sort((a, b) => {
        const tier = TIER_RANK.indexOf(tierOf(b)) - TIER_RANK.indexOf(tierOf(a));
        if (tier !== 0) {
            return tier;
        }
        return order.indexOf(typeOf(a)) - order.indexOf(typeOf(b));
    });
    return usable[0] ?? null;
}

/** The melee weapon among `names` that the list knows, or null. */
export function knownMeleeWeapon(names: readonly string[]): string | null {
    const have = new Set(names.map(n => n.toLowerCase()));
    return MELEE_WEAPONS.find(name => have.has(name.toLowerCase())) ?? null;
}
