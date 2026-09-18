export const LOGOUT_BUTTON_COM = 2458;

type LogoutPage = {
    evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
    waitForFunction(fn: () => boolean, arg: undefined, opts: { timeout: number }): Promise<unknown>;
};

type LogoutHost = {
    rs2b0t?: {
        actions?: { ifButton?(c: number): boolean };
        client?: {
            ingame?: boolean;
            logoutTimer?: number;
            stream?: { remoteClosed?: boolean; socket?: { readyState: number } } | null;
            logout?(): Promise<void> | void;
        };
    };
};

export async function pressCleanLogout(page: LogoutPage, timeoutMs = 20_000): Promise<'ifbutton' | 'client'> {
    const via = await page.evaluate(com => {
        const g = globalThis as never as LogoutHost;
        const client = g.rs2b0t?.client;
        if (!client || typeof client.logout !== 'function') {
            throw new Error('clean logout: client unavailable');
        }
        // Why: the unopened logout tab can leave clientCode unset, so arm its timer here.
        if (typeof client.logoutTimer === 'number') {
            client.logoutTimer = 250;
        }
        if (g.rs2b0t?.actions?.ifButton?.(com)) {
            return 'ifbutton' as const;
        }
        void client?.logout?.();
        return 'client' as const;
    }, LOGOUT_BUTTON_COM);

    await page.waitForFunction(() => {
        const g = globalThis as never as LogoutHost;
        const client = g.rs2b0t?.client;
        if (!client?.ingame) {
            return true;
        }
        const stream = client.stream;
        const remoteClosed = !stream || stream.remoteClosed === true || stream.socket?.readyState === 3;
        if (remoteClosed) {
            void client.logout?.();
            return true;
        }
        return false;
    }, undefined, { timeout: timeoutMs });

    return via;
}
