// Why: in Server content general_use/web.rs2 and slash_checker.rs2 a menu Slash needs a worn weapon with a slashattack_anim, while use-on accepts a plain `knife` or any item with slashattack_anim.
// Why: slash-capable weapons are approximated by display name, the same family as the elemental workshop and Entrana heuristics.
// Why: plain "Knife" matches by name, while bronze and iron throwing knives are different objs and do not count as the content `knife`.

const SLASH_NAME_RE =
    /\b(scimitar|longsword|sword|dagger|battleaxe|2h\b|two.handed|claws|whip|scythe|halberd|machete|abyssal|silverlight|excalibur|darklight)\b/i;

/** Exact display name of content obj `knife` (not bronze_knife etc.). */
export const WEB_SLASH_KNIFE_NAME = 'Knife';

/** Content `bigweb_slashed` display name after a successful cut. */
export const WEB_SLASHED_NAME = 'Slashed web';

export function isSlashWeaponName(name: string | null | undefined): boolean {
    if (!name) {
        return false;
    }
    const n = name.trim();
    if (!n || /^knife$/i.test(n)) {
        return false; // handled separately as content knife
    }
    // Thrown metal knives are not content `knife` and usually lack slash-use-on.
    if (/^(bronze|iron|steel|black|mithril|adamant|rune|dragon)\s+knife$/i.test(n)) {
        return false;
    }
    return SLASH_NAME_RE.test(n);
}

export function isContentKnifeName(name: string | null | undefined): boolean {
    return !!name && /^knife$/i.test(name.trim());
}

/** True if inv/worn counts include a plain Knife or a slash-capable weapon name. */
export function recordsHaveSlashTool(
    items: Readonly<Record<string, number>>,
    worn: Readonly<Record<string, number>> = {}
): boolean {
    for (const [name, count] of Object.entries(items)) {
        if (count > 0 && (isContentKnifeName(name) || isSlashWeaponName(name))) {
            return true;
        }
    }
    for (const [name, count] of Object.entries(worn)) {
        if (count > 0 && (isContentKnifeName(name) || isSlashWeaponName(name))) {
            return true;
        }
    }
    return false;
}

/** Transport loc is a slashable web (transports.json bigweb_slashable). */
export function isSlashWebTransport(locName: string | undefined, action: string | undefined): boolean {
    return /^slash$/i.test(action ?? '') && /web/i.test(locName ?? '');
}

/**
 * Server chat from general_use/scripts/web.rs2 `cut_web` / slash guards.
 * Live execute must key off these — random(2) fails need immediate retry.
 */
export const WEB_SLASH_SUCCESS = /you slash the web apart/i;
export const WEB_SLASH_FAIL = /you fail to cut through it/i;
export const WEB_SLASH_NO_BLADE = /only a sharp blade can cut through this sticky web/i;

type WebSlashChat = 'success' | 'fail' | 'no_blade' | null;

export function classifyWebSlashChat(text: string): WebSlashChat {
    if (WEB_SLASH_SUCCESS.test(text)) {
        return 'success';
    }
    if (WEB_SLASH_FAIL.test(text)) {
        return 'fail';
    }
    if (WEB_SLASH_NO_BLADE.test(text)) {
        return 'no_blade';
    }
    return null;
}
