import type { TrafficPayload } from '../../src/bot/multibox/ResourcePayload.js';

type TrafficDirection = 'received' | 'sent';
type Payload = string | ArrayBuffer | ArrayBufferView;

const encoder = new TextEncoder();

export function payloadByteLength(payload: Payload): number {
    if (typeof payload === 'string') {
        return encoder.encode(payload).byteLength;
    }
    return payload.byteLength;
}

/** Application payload bytes counted by the proxy. */
export class ProxyTrafficCounter {
    private receivedBytes = 0;
    private sentBytes = 0;
    private unavailableReason: string | null = null;

    addReceived(bytes: number): void {
        this.add('received', bytes);
    }

    addSent(bytes: number): void {
        this.add('sent', bytes);
    }

    snapshot(): TrafficPayload {
        if (this.unavailableReason !== null) {
            return { status: 'unavailable', reason: this.unavailableReason };
        }
        return {
            status: 'available',
            receivedBytes: this.receivedBytes,
            sentBytes: this.sentBytes
        };
    }

    countStream(stream: ReadableStream<Uint8Array>, direction: TrafficDirection): ReadableStream<Uint8Array> {
        const reader = stream.getReader();
        return new ReadableStream<Uint8Array>({
            pull: async controller => {
                const next = await reader.read();
                if (next.done) {
                    controller.close();
                    return;
                }
                this.add(direction, next.value.byteLength);
                controller.enqueue(next.value);
            },
            cancel: reason => {
                return reader.cancel(reason);
            }
        });
    }

    private add(direction: TrafficDirection, bytes: number): void {
        if (this.unavailableReason !== null) {
            return;
        }
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            this.unavailableReason = 'proxy traffic counter received an invalid byte count';
            return;
        }

        const current = direction === 'received' ? this.receivedBytes : this.sentBytes;
        const next = current + bytes;
        if (!Number.isSafeInteger(next)) {
            this.unavailableReason = 'proxy traffic counter exceeded the safe integer range';
            return;
        }
        if (direction === 'received') {
            this.receivedBytes = next;
        } else {
            this.sentBytes = next;
        }
    }
}
