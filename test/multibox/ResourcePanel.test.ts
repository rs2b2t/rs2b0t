import { afterEach, describe, expect, test } from 'bun:test';
import { ResourcePanel, type ResourcePanelNodes } from '#/bot/multibox/ResourcePanel.js';
import type { TrafficSnapshot } from '#/bot/adapter/TrafficAdapter.js';
import type { CpuPayload, MemoryPayload, ResourcePayload, TrafficPayload } from '#/bot/multibox/ResourcePayload.js';

const GIB = 1024 ** 3;

function makeNodes(): ResourcePanelNodes {
    const botCount = document.createElement('span');
    const cpu = document.createElement('span');
    const memory = document.createElement('span');
    const traffic = document.createElement('span');
    document.body.append(botCount, cpu, memory, traffic);
    return { botCount, cpu, memory, traffic };
}

function makeNodesWithRows(): ResourcePanelNodes & { cpuRow: HTMLElement; memoryRow: HTMLElement } {
    const base = makeNodes();
    const cpuRow = document.createElement('div');
    const memoryRow = document.createElement('div');
    document.body.append(cpuRow, memoryRow);
    return { ...base, cpuRow, memoryRow };
}

function browserTotals(receivedBytes: number, sentBytes: number): TrafficSnapshot {
    return { status: 'available', receivedBytes, sentBytes };
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function payload(cpu: CpuPayload, memory: MemoryPayload, sampledAt = 1_700_000_000_000, traffic: TrafficPayload = availableTraffic()): ResourcePayload {
    return {
        scope: 'bot-browser',
        sampledAt,
        cpu,
        memory,
        traffic
    };
}

function ready(cpuCores = 1.6, memoryBytes = 2.75 * GIB, sampledAt = 1_700_000_000_000, traffic: TrafficPayload = availableTraffic()): ResourcePayload {
    return payload({ status: 'available', cpuCores, cpuPercent: 10, logicalCpuCount: 16 }, { status: 'available', memoryBytes, memorySource: 'pss' }, sampledAt, traffic);
}

function availableTraffic(receivedBytes = 0, sentBytes = 0): TrafficPayload {
    return { status: 'available', receivedBytes, sentBytes };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('ResourcePanel', () => {
    test('a hidden host row is actually not displayed, despite the row being a flex box', async () => {
        const html = await Bun.file('public-bot/multibox.html').text();
        expect(html).toContain('.mbx-resource-row[hidden] { display: none; }');
    });

    test('the resource card starts explicitly measuring and contains only the requested metrics', async () => {
        const html = await Bun.file('public-bot/multibox.html').text();
        expect(html.indexOf('id="mbx-resources"')).toBeGreaterThan(html.indexOf('id="mbx-add"'));
        expect(html).toContain('>CPU<');
        expect(html).toContain('>RAM<');
        expect(html).toContain('>Traffic<');
        expect(html).toContain('>measuring…<');
        expect(html).not.toContain('>—<');
        expect(html).not.toContain('>Wall<');
        expect(html).not.toContain('>Host<');
        expect(html).not.toContain('>Headroom<');
    });

    test('formats available values, bot count, and cumulative traffic rates', async () => {
        const nodes = makeNodes();
        let body = ready(1.6, 2.75 * GIB, 1000, availableTraffic(10_000, 4_000));
        const calls: Array<{ input: string; cache?: RequestCache }> = [];
        const panel = new ResourcePanel(nodes, {
            fetch: async (input, init) => {
                calls.push({ input, cache: init.cache });
                return response(body);
            }
        });

        panel.setBotCount(14, 6);
        expect(await panel.refresh()).toBe(true);
        expect(nodes.botCount.textContent).toBe('14 bots (6 running)');
        expect(nodes.cpu.textContent).toBe('1.6 cores (10% of 16)');
        expect(nodes.memory.textContent).toBe('2.8 GB');
        expect(nodes.memory.title).toBe('Memory source: pss');
        expect(nodes.traffic.textContent).toBe('measuring…');

        body = ready(1.6, 2.75 * GIB, 3000, availableTraffic(12_048, 5_024));
        expect(await panel.refresh()).toBe(true);
        expect(nodes.traffic.textContent).toBe('↓ 1 KB/s  ↑ 512 B/s');
        expect(calls).toEqual([
            { input: '/__rs2b0t/resources', cache: 'no-store' },
            { input: '/__rs2b0t/resources', cache: 'no-store' }
        ]);

        panel.setBotCount(1, 0);
        expect(nodes.botCount.textContent).toBe('1 bot (0 running)');
    });

    test('renders measured zero traffic after two idle proxy samples', async () => {
        const nodes = makeNodes();
        let body = ready(1, GIB, 1000, availableTraffic());
        const panel = new ResourcePanel(nodes, { fetch: async () => response(body) });

        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');
        body = ready(1, GIB, 2000, availableTraffic());
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('↓ 0 B/s  ↑ 0 B/s');
        expect(nodes.traffic.title).toBe('');
    });

    test('uses direct browser WebSocket totals instead of a motionless proxy counter', async () => {
        const nodes = makeNodes();
        let body = ready(1, GIB, 1000, availableTraffic(99, 20));
        let browserTraffic: TrafficSnapshot = { status: 'measuring' };
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(body),
            getTrafficSnapshot: () => browserTraffic
        });

        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');

        browserTraffic = { status: 'available', receivedBytes: 4096, sentBytes: 512 };
        body = ready(1, GIB, 2000, availableTraffic(99, 20));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');

        browserTraffic = { status: 'available', receivedBytes: 6144, sentBytes: 1024 };
        body = ready(1, GIB, 3000, availableTraffic(99, 20));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('↓ 2 KB/s  ↑ 512 B/s');
    });

    test('shows CPU warm-up independently while rendering available RAM', async () => {
        const nodes = makeNodes();
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(payload({ status: 'warming-up' }, { status: 'available', memoryBytes: 512 * 1024 ** 2, memorySource: 'rss' }))
        });

        expect(await panel.refresh()).toBe(true);
        expect(nodes.cpu.textContent).toBe('measuring…');
        expect(nodes.cpu.title).toBe('waiting for a second CPU sample');
        expect(nodes.memory.textContent).toBe('512 MB');
        expect(nodes.memory.title).toBe('Memory source: rss');
    });

    test('identifies Linux cgroup memory.current as the RAM source', async () => {
        const nodes = makeNodes();
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(payload(
                { status: 'warming-up' },
                { status: 'available', memoryBytes: 768 * 1024 ** 2, memorySource: 'cgroup' }
            ))
        });

        expect(await panel.refresh()).toBe(true);
        expect(nodes.memory.textContent).toBe('768 MB');
        expect(nodes.memory.title).toBe('Memory source: cgroup v2 memory.current');
    });

    test('never rounds a positive measured CPU value down to zero', async () => {
        const nodes = makeNodes();
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(payload(
                { status: 'available', cpuCores: 0.004, cpuPercent: 0.025, logicalCpuCount: 16 },
                { status: 'available', memoryBytes: GIB, memorySource: 'pss' }
            ))
        });

        expect(await panel.refresh()).toBe(true);
        expect(nodes.cpu.textContent).toBe('<0.01 cores (0.03% of 16)');
    });

    test('an unavailable field clears only itself and exposes the reason', async () => {
        const nodes = makeNodes();
        let body: ResourcePayload = payload({ status: 'available', cpuCores: 1, cpuPercent: 12.5, logicalCpuCount: 8 }, { status: 'unavailable', reason: 'one browser process could not be measured' });
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(body)
        });

        expect(await panel.refresh()).toBe(true);
        expect(nodes.cpu.textContent).toBe('1 core (12.5% of 8)');
        expect(nodes.memory.textContent).toBe('unavailable — one browser process could not be measured');
        expect(nodes.memory.title).toBe('one browser process could not be measured');

        body = payload({ status: 'unavailable', reason: 'CPU clock unavailable' }, { status: 'available', memoryBytes: GIB, memorySource: 'pss' });
        expect(await panel.refresh()).toBe(true);
        expect(nodes.cpu.textContent).toBe('unavailable — CPU clock unavailable');
        expect(nodes.cpu.title).toBe('CPU clock unavailable');
        expect(nodes.memory.textContent).toBe('1 GB');
    });

    test('a connection rejection clears all stale resource numbers to offline', async () => {
        const nodes = makeNodes();
        let offline = false;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => {
                if (offline) throw new TypeError('fetch failed');
                return response(ready(1.6, 2.75 * GIB, 1000, availableTraffic(100, 50)));
            }
        });

        expect(await panel.refresh()).toBe(true);
        offline = true;
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('offline — resource monitor is offline');
        expect(nodes.memory.textContent).toBe('offline — resource monitor is offline');
        expect(nodes.cpu.title).toBe('resource monitor is offline');
        expect(nodes.memory.title).toBe('resource monitor is offline');
        expect(nodes.traffic.textContent).toBe('offline — resource monitor is offline');
        expect(nodes.traffic.title).toBe('resource monitor is offline');
    });

    test('HTTP, malformed envelopes, and the wrong scope are explicit monitor errors', async () => {
        const nodes = makeNodes();
        let result = response({ error: 'broken' }, 503);
        const panel = new ResourcePanel(nodes, {
            fetch: async () => result
        });

        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned HTTP 503');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned HTTP 503');
        expect(nodes.cpu.title).toBe('resource monitor returned HTTP 503');

        result = response('not an object');
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.memory.title).toBe('resource monitor returned an invalid response');

        result = response({ ...ready(), scope: 'host' });
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.cpu.title).toBe('resource monitor returned an invalid response');

        const { sampledAt: _sampledAt, ...withoutSampleTime } = ready();
        result = response(withoutSampleTime);
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned an invalid response');
    });

    test('nested schema errors affect only the malformed field and old flat payloads are rejected', async () => {
        const nodes = makeNodes();
        let body: object = {
            scope: 'bot-browser',
            sampledAt: 1_700_000_000_000,
            cpu: { status: 'available', cpuCores: -1, cpuPercent: 10, logicalCpuCount: 8 },
            memory: { status: 'available', memoryBytes: GIB, memorySource: 'pss' },
            traffic: availableTraffic()
        };
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(body)
        });

        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned an invalid CPU response');
        expect(nodes.memory.textContent).toBe('1 GB');

        body = {
            ...ready(),
            cpu: { status: 'available', cpuCores: 1, cpuPercent: 10, logicalCpuCount: 8 },
            memory: { status: 'available', memoryBytes: GIB, memorySource: 'smaps' }
        };
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('1 core (10% of 8)');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned an invalid RAM response');

        body = { cpuCores: 1, cpuPercent: 10, logicalCpuCount: 8, memoryBytes: GIB };
        expect(await panel.refresh()).toBe(false);
        expect(nodes.cpu.textContent).toBe('monitor error — resource monitor returned an invalid response');
        expect(nodes.memory.textContent).toBe('monitor error — resource monitor returned an invalid response');
    });

    test('recovers from offline and unavailable states without retaining stale values', async () => {
        const nodes = makeNodes();
        let mode: 'offline' | 'partial' | 'ready' = 'offline';
        const panel = new ResourcePanel(nodes, {
            fetch: async () => {
                if (mode === 'offline') throw new TypeError('offline');
                if (mode === 'partial') {
                    return response(payload({ status: 'unavailable', reason: 'temporarily unavailable' }, { status: 'available', memoryBytes: GIB, memorySource: 'pss' }));
                }
                return response(ready(2, 3 * GIB));
            }
        });

        await panel.refresh();
        expect(nodes.cpu.textContent).toBe('offline — resource monitor is offline');
        expect(nodes.memory.textContent).toBe('offline — resource monitor is offline');

        mode = 'partial';
        await panel.refresh();
        expect(nodes.cpu.textContent).toBe('unavailable — temporarily unavailable');
        expect(nodes.memory.textContent).toBe('1 GB');

        mode = 'ready';
        await panel.refresh();
        expect(nodes.cpu.textContent).toBe('2 cores (10% of 16)');
        expect(nodes.memory.textContent).toBe('3 GB');
        expect(nodes.cpu.title).toBe('');
    });

    test('traffic health gaps clear the rate baseline and later available samples recover', async () => {
        const nodes = makeNodes();
        let body: object = ready(1, GIB, 1000, { status: 'available', receivedBytes: Number.NaN, sentBytes: 0 } as TrafficPayload);
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(body)
        });

        expect(await panel.refresh()).toBe(false);
        expect(nodes.traffic.textContent).toBe('monitor error — resource monitor returned an invalid Traffic response');
        expect(nodes.traffic.title).toBe('resource monitor returned an invalid Traffic response');

        body = ready(1, GIB, 2000, availableTraffic(100, 50));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');

        body = ready(1, GIB, 3000, { status: 'unavailable', reason: 'proxy traffic counter overflowed' });
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('unavailable — proxy traffic counter overflowed');
        expect(nodes.traffic.title).toBe('proxy traffic counter overflowed');

        body = ready(1, GIB, 4000, availableTraffic(200, 100));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');

        body = ready(1, GIB, 6000, availableTraffic(201, 100));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('↓ <1 B/s  ↑ 0 B/s');

        body = ready(1, GIB, 7000, availableTraffic(10, 5));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('measuring…');

        body = ready(1, GIB, 8000, availableTraffic(1034, 517));
        await panel.refresh();
        expect(nodes.traffic.textContent).toBe('↓ 1 KB/s  ↑ 512 B/s');
    });

    test('refreshes only provided nodes and preserves a bot iframe exactly', async () => {
        const iframe = document.createElement('iframe');
        iframe.src = '/bot.html?box=alice';
        document.body.appendChild(iframe);
        const originalWindow = iframe.contentWindow;
        const originalSrc = iframe.src;
        const nodes = makeNodes();
        let failMemory = false;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response(failMemory ? payload({ status: 'available', cpuCores: 1, cpuPercent: 12.5, logicalCpuCount: 8 }, { status: 'unavailable', reason: 'not readable' }) : ready(1, GIB))
        });

        await panel.refresh();
        failMemory = true;
        await panel.refresh();

        expect(document.querySelector('iframe')).toBe(iframe);
        expect(iframe.contentWindow).toBe(originalWindow);
        expect(iframe.src).toBe(originalSrc);
        expect(nodes.cpu.textContent).toBe('1 core (12.5% of 8)');
        expect(nodes.memory.textContent).toBe('unavailable — not readable');
    });
});

describe('ResourcePanel without a resource monitor', () => {
    test('a 404 hides the host rows and keeps traffic measured in the browser', async () => {
        const nodes = makeNodesWithRows();
        let bytes = 0;
        let clock = 1_700_000_000_000;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response({}, 404),
            getTrafficSnapshot: () => browserTotals(bytes, bytes),
            now: () => clock
        });

        await panel.refresh();
        expect(nodes.cpuRow.hidden).toBe(true);
        expect(nodes.memoryRow.hidden).toBe(true);

        bytes = 2048;
        clock += 1000;
        await panel.refresh();
        expect(nodes.traffic.textContent).toContain('↓');
        expect(nodes.traffic.textContent).not.toContain('offline');
    });

    test('once latched off it stops polling the missing endpoint', async () => {
        const nodes = makeNodesWithRows();
        let fetches = 0;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => {
                fetches++;
                return response({}, 404);
            },
            getTrafficSnapshot: () => browserTotals(0, 0),
            now: () => 1_700_000_000_000
        });

        await panel.refresh();
        await panel.refresh();
        await panel.refresh();
        expect(fetches).toBe(1);
    });

    test('a monitor that exists but is broken still reports on every row', async () => {
        const nodes = makeNodesWithRows();
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response({}, 500),
            getTrafficSnapshot: () => browserTotals(0, 0),
            now: () => 1_700_000_000_000
        });

        await panel.refresh();
        expect(nodes.cpuRow.hidden).toBe(false);
        expect(nodes.memoryRow.hidden).toBe(false);
        expect(nodes.cpu.textContent).toContain('monitor error');
        expect(nodes.traffic.textContent).toContain('monitor error');
    });
});
