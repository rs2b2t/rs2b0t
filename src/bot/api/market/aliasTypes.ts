/** One obj inside a group of objs the content gave the same display name. */
export interface CollisionMember {
    obj: string;
    id: number;
    /** Debugname tokens no sibling shares, so the words that separate this one. Empty where nothing survived. */
    words: readonly string[];
}

/** Objs the content gives the same display name, so a customer naming one names them all. */
export interface NameCollision {
    name: string;
    objs: readonly CollisionMember[];
}

/** What a customer may call one obj, and what the shop calls it back. */
export interface ItemAlias {
    words: readonly string[];
    label: string;
}
