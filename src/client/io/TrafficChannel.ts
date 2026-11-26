const CHANNEL_NAME = 'rs2b0t:traffic:v1';

export interface TrafficChannelOptions {
    channelName?: string;
    channelFactory?: (name: string) => BroadcastChannel | null;
}

interface PublisherPort {
    port: MessagePort;
    close(): void;
}

type TrafficWall = Document & { rs2b0tOpenTrafficPort?: () => PublisherPort | null };

export function installWallTrafficChannel(wall: TrafficWall, receive: (data: unknown) => void): () => void {
    const receivers = new Set<MessagePort>();
    const open = (): PublisherPort | null => {
        let channel: MessageChannel;
        try {
            channel = new MessageChannel();
        } catch {
            return null;
        }
        const receiver: MessagePort & { unref?: () => void } = channel.port1;
        const sender = channel.port2;
        receivers.add(receiver);
        receiver.onmessage = event => receive(event.data);
        receiver.addEventListener('close', () => receivers.delete(receiver), { once: true });
        return {
            port: sender,
            close() {
                sender.close();
                // Why: the disentangled receiver can drain already-posted deltas before collection.
                receivers.delete(receiver);
                receiver.unref?.();
            }
        };
    };
    wall.rs2b0tOpenTrafficPort = open;
    return () => {
        if (wall.rs2b0tOpenTrafficPort === open) wall.rs2b0tOpenTrafficPort = () => null;
        for (const port of receivers) port.close();
        receivers.clear();
    };
}

export function openFrameTrafficPort(frame: Window = globalThis.self): PublisherPort | null | undefined {
    const wall: TrafficWall | undefined = frame?.frameElement?.ownerDocument;
    const publisher = wall?.rs2b0tOpenTrafficPort?.();
    if (!publisher) return publisher;
    const { port, close: release } = publisher;
    const onPageHide = (event: PageTransitionEvent) => {
        if (!event.persisted) close();
    };
    function close() {
        frame.removeEventListener('pagehide', onPageHide);
        release();
    }
    frame.addEventListener('pagehide', onPageHide);
    return { port, close };
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
