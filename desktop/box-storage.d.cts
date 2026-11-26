export interface BoxStorageUpdate {
    usernames: string[];
    values: Record<string, string>;
}

export function boxStoragePrefix(username: string): string;
export function boxSuffix(key: string, prefix: string, id: string): string | null;
export function replaceBoxItems(store: Pick<Storage, 'setItem' | 'removeItem'>, keys: string[], update: BoxStorageUpdate): void;
