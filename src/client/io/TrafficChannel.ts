const CHANNEL_NAME = 'rs2b0t:traffic:v1';

export interface TrafficChannelOptions {
    channelName?: string;
    channelFactory?: (name: string) => BroadcastChannel | null;
}

export const TRAFFIC_END = 'rs2b0t:traffic:end';

interface PublisherPort {
    port: MessagePort;
    close(): void;
}

type TrafficWall = Document & { rs2b0tOpenTrafficPort?: () => PublisherPort | null };

export function installWallTrafficChannel(wall: TrafficWall, receive: (data: unknown) => void): () => void {
    // Why: a terminated worker can disappear without a close event while its last messages are still queued.
    const receivers = new Set<WeakRef<MessagePort>>();
    const collected = new FinalizationRegistry<WeakRef<MessagePort>>(ref => receivers.delete(ref));
    const dispose = (ref: WeakRef<MessagePort>) => {
        if (!receivers.delete(ref)) return;
        collected.unregister(ref);
        const receiver = ref.deref();
        if (receiver) {
            receiver.onmessage = null;
            receiver.close();
        }
    };
    const open = (): PublisherPort | null => {
        let channel: MessageChannel;
        try {
            channel = new MessageChannel();
        } catch {
            return null;
        }
        const { port1: receiver, port2: sender } = channel;
        const ref = new WeakRef(receiver);
        receivers.add(ref);
        collected.register(receiver, ref, ref);
        receiver.onmessage = event => {
            if (event.data === TRAFFIC_END) dispose(ref);
            else receive(event.data);
        };
        receiver.addEventListener('close', () => dispose(ref), { once: true });
        return {
            port: sender,
            close() {
                sender.postMessage(TRAFFIC_END);
                sender.close();
            }
        };
    };
    wall.rs2b0tOpenTrafficPort = open;
    return () => {
        if (wall.rs2b0tOpenTrafficPort === open) wall.rs2b0tOpenTrafficPort = () => null;
        for (const ref of receivers) dispose(ref);
    };
}

function openFrameTrafficPort(frame: Window = globalThis.self, onClose?: () => void): PublisherPort | null | undefined {
    const wall: TrafficWall | undefined = frame?.frameElement?.ownerDocument;
    const publisher = wall?.rs2b0tOpenTrafficPort?.();
    if (!publisher) return publisher;
    const { port, close: release } = publisher;
    const onPageHide = (event: PageTransitionEvent) => {
        if (!event.persisted) close();
    };
    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        frame.removeEventListener('pagehide', onPageHide);
        try {
            onClose?.();
        } finally {
            release();
        }
    }
    frame.addEventListener('pagehide', onPageHide);
    return { port, close };
}

export function openWorkerTrafficPort(stopWorker: () => void, frame: Window = globalThis.self): PublisherPort | null | undefined {
    return openFrameTrafficPort(frame, stopWorker);
}

export function openTrafficChannel({ channelName = CHANNEL_NAME, channelFactory }: TrafficChannelOptions): BroadcastChannel | null {
    try {
        if (channelFactory) return channelFactory(channelName);
        return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
    } catch {
        return null;
    }
}

export function openPublisherChannel(options: TrafficChannelOptions): Pick<MessagePort, 'close' | 'postMessage'> | null {
    if (typeof window !== 'undefined' && options.channelName === undefined && !options.channelFactory) {
        const publisher = openFrameTrafficPort();
        if (publisher === null) return null;
        if (publisher) return { postMessage: data => publisher.port.postMessage(data), close: publisher.close };
    }
    return openTrafficChannel(options);
}
