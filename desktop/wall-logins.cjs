const { LoginCoordinator } = require('./login-coordinator.cjs');

class WallLogins extends LoginCoordinator {
    attach(contents, origin) {
        const requests = new Map();
        const clear = () => {
            for (const request of requests.values()) request.leaveQueue();
            requests.clear();
        };
        contents.on('render-process-gone', clear);
        contents.once('destroyed', clear);
        contents.on('did-start-navigation', details => {
            if (details.isMainFrame && !details.isSameDocument) clear();
        });
        const handle = (id, action, delay) => {
            if (action === 'holdFor') {
                this.holdFor(delay);
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
        contents.ipc.on('rs2b0t-login', (event, id, action, delay) => {
            const frame = event.senderFrame;
            event.returnValue = frame === contents.mainFrame && new URL(frame.url).origin === origin && Number.isSafeInteger(id)
                ? handle(id, action, delay)
                : null;
        });
    }
}

module.exports = { WallLogins };
