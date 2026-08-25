/** One slot on a trade side. */
export interface OfferItem {
    id: number;
    name: string | null;
    count: number;
}

/** One priced line of an appraisal. */
export interface ValuedLine {
    id: number;
    name: string;
    count: number;
    each: number;
    value: number;
}
