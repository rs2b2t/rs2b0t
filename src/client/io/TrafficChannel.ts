const CHANNEL_NAME = 'rs2b0t:traffic:v1';

export interface TrafficChannelOptions {
    channelName?: string;
    channelFactory?: (name: string) => BroadcastChannel | null;
}

export function installWallTrafficChannel(wall: Document): string {
    const id = crypto.getRandomValues(new Uint32Array(4)).join('-');
    const name = `${CHANNEL_NAME}:${id}`;
    wall.documentElement.dataset.trafficChannel = name;
    return name;
}

type TrafficRealm = Pick<Window, 'frameElement'> | Pick<WorkerOptions, 'name'>;

export function publisherTrafficChannel(realm: TrafficRealm = globalThis.self): string | undefined {
    if (!realm) return undefined;
    if ('frameElement' in realm) return realm.frameElement?.ownerDocument.documentElement.dataset.trafficChannel;
    const name = realm.name;
    return name?.startsWith(`${CHANNEL_NAME}:`) ? name : undefined;
}

export function openTrafficChannel({ channelName = CHANNEL_NAME, channelFactory }: TrafficChannelOptions): BroadcastChannel | null {
    try {
        if (channelFactory) return channelFactory(channelName);
        return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
    } catch {
        return null;
    }
}
