/** One object in a group sharing a display name. */
export interface CollisionMember {
    obj: string;
    id: number;
/** Unique debugname tokens that distinguish this object; empty when none exist. */
    words: readonly string[];
}

/** Objects sharing the same display name. */
export interface NameCollision {
    name: string;
    objs: readonly CollisionMember[];
}

/** Customer alias and the shop's display label. */
export interface ItemAlias {
    words: readonly string[];
    label: string;
}
