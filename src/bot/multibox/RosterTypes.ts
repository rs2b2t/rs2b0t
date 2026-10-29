export interface RosterClient {
    scripts(): string[];
    selectedScript(): string;
    readSettings(script: string): Record<string, string>;
    assignScript(script: string): void;
    copySettings(script: string, values: Record<string, string>): void;
    startScript(): void;
    stopScript(): void;
    travelTo(destination: string): Promise<void>;
    editSettings(): void;
}

export function isRosterScript(name: string): boolean {
    return !!name.trim() && !['Global', 'MapPicker', 'Loadouts', 'PriceBooks'].includes(name);
}
