export async function waitForWorldSwitch(prepare: () => boolean, signal: AbortSignal, timeoutMs = 30_000): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!signal.aborted) {
        if (prepare()) return true;
        if (performance.now() >= deadline) return false;
        await new Promise<void>(resolve => {
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', finish);
                resolve();
            };
            const timer = setTimeout(finish, 100);
            signal.addEventListener('abort', finish, { once: true });
        });
    }
    return false;
}
