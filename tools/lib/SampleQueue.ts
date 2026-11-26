export class SampleQueue {
    private tail: Promise<void> = Promise.resolve();

    enqueue<T>(sample: () => Promise<T>): Promise<T> {
        const result = this.tail.then(sample);
        this.tail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }
}
