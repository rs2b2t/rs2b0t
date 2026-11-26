const { LoginCoordinator } = require('./login-coordinator.cjs');

class WallLogins extends LoginCoordinator {
    profiles = new Map();

    attach(contents, origin) {
        const requests = new Map();
        const clear = () => {
            for (const request of requests.values()) request.leaveQueue();
            requests.clear();
            for (const [name, owner] of this.profiles) if (owner === contents) this.profiles.delete(name);
        };
        contents.on('render-process-gone', clear);
        contents.once('destroyed', clear);
        contents.on('did-start-navigation', details => {
            if (details.isMainFrame && !details.isSameDocument) clear();
        });
        const handle = (id, action, value) => {
            if (action === 'claimProfile' || action === 'releaseProfile') {
                if (typeof value !== 'string' || !value || value.length > 12) return false;
                if (action === 'claimProfile') {
                    if (this.profiles.has(value)) return false;
                    this.profiles.set(value, contents);
                    return true;
                }
                if (this.profiles.get(value) === contents) this.profiles.delete(value);
                return null;
            }
            if (action === 'holdFor') {
                this.holdFor(value);
                return null;
            }
            if (action === 'requestPermit' && !requests.has(id)) requests.set(id, this.register());
            const request = requests.get(id);
            if (!request) return null;
            if (action === 'requestPermit') {
                const granted = request.requestPermit();
                if (granted) requests.delete(id);
                return granted;
            }
            if (action === 'queueStatus') return request.queueStatus();
            if (action === 'leaveQueue') {
                request.leaveQueue();
                requests.delete(id);
            }
            return null;
        };
        contents.ipc.on('rs2b0t-login', (event, id, action, value) => {
            const frame = event.senderFrame;
            event.returnValue = frame === contents.mainFrame && new URL(frame.url).origin === origin && Number.isSafeInteger(id)
                ? handle(id, action, value)
                : null;
        });
    }
}

module.exports = { WallLogins };
