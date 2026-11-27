export const SAMPLE_RATE = 22050;

export function millisecondsToSamples(milliseconds: number): number {
    return ((milliseconds * SAMPLE_RATE) / 1000) | 0;
}
