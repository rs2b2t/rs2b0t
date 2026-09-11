/** Mirrors 274bot `api::interact::logout` / `StepKind::Relog`.
 *  Why: IF_BUTTON on the CC_LOGOUT iface arms logoutTimer (250); a dead socket then titles instead of lostCon reconnect. Re-pressing re-arms the timer and never leaves. */

export const CC_LOGOUT = 205;

export function logoutIfaceId(ifaces: ReadonlyArray<{ clientCode?: number } | null | undefined>): number | null {
    for (let i = 0; i < ifaces.length; i++) {
        if (ifaces[i]?.clientCode === CC_LOGOUT) {
            return i;
        }
    }
    return null;
}

/** Host `lostCon`: pending logout titles; a dead socket with timer 0 reconnects. */
export function titleAfterLogoutPress(state: { ingame: boolean; logoutTimer: number; remoteClosed: boolean }): 'ingame' | 'title' | 'lost-con-reconnect' {
    if (!state.ingame) {
        return 'title';
    }
    if (!state.remoteClosed) {
        return 'ingame';
    }
    return state.logoutTimer > 0 ? 'title' : 'lost-con-reconnect';
}

/** Relog wait: leave as soon as we are off-world or the socket is dead. Do not wait for the 15s overlay. */
export function finishRelog(ingame: boolean, remoteClosed: boolean): 'wait' | 'done' | 'title-now' {
    if (!ingame) {
        return 'done';
    }
    return remoteClosed ? 'title-now' : 'wait';
}

/** 274bot Relog presses this iface (CC_LOGOUT lives here in the cache). */
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

/** One CC_LOGOUT press, then title as soon as LOGOUT lands or the socket dies. Never wait for lostCon. */
export async function pressCleanLogout(page: LogoutPage, timeoutMs = 20_000): Promise<'ifbutton' | 'client'> {
    const via = await page.evaluate(com => {
        const g = globalThis as never as LogoutHost;
        const client = g.rs2b0t?.client;
        // Why: IfType.list[2458].clientCode can be 0 when the logout tab is not open, so ifButton never runs CC_LOGOUT. Arm the 250-frame timer the way clientButton(205) would.
        if (client && typeof client.logoutTimer === 'number') {
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
