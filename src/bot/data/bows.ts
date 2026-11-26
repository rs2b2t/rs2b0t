export const SHORTBOW = { name: 'Shortbow', id: 841, level: 1 } as const;

export const BOW_TIERS = [
    { name: 'Magic shortbow', id: 861, level: 50 },
    { name: 'Magic longbow', id: 859, level: 50 },
    { name: 'Yew shortbow', id: 857, level: 40 },
    { name: 'Yew longbow', id: 855, level: 40 },
    { name: 'Maple shortbow', id: 853, level: 30 },
    { name: 'Maple longbow', id: 851, level: 30 },
    { name: 'Willow shortbow', id: 849, level: 20 },
    { name: 'Willow longbow', id: 847, level: 20 },
    { name: 'Oak shortbow', id: 843, level: 5 },
    { name: 'Oak longbow', id: 845, level: 5 },
    SHORTBOW,
    { name: 'Longbow', id: 839, level: 1 }
] as const;
