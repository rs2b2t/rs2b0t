import fs from 'fs';
import path from 'path';

import { minify } from 'terser';

import { nth_identifier } from './identifier.js';

const define = {
    'process.env.SECURE_ORIGIN': JSON.stringify(process.env.SECURE_ORIGIN ?? 'false'),
    // original key, used 2003-2010
    'process.env.LOGIN_RSAE': JSON.stringify(process.env.LOGIN_RSAE ?? '58778699976184461502525193738213253649000149147835990136706041084440742975821'),
    'process.env.LOGIN_RSAN': JSON.stringify(process.env.LOGIN_RSAN ?? '7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789'),
    'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString())
};

// ----

type BunOutput = {
    source: string;
    sourcemap: string;
}

async function bunBuild(entry: string, external: string[] = [], minify = true, drop: string[] = []): Promise<BunOutput> {
    const build = await Bun.build({
        entrypoints: [entry],
        sourcemap: 'external',
        define,
        external,
        minify,
        drop,
    });

    if (!build.success) {
        build.logs.forEach((x: any) => console.log(x));
        process.exit(1);
    }

    return {
        source: await build.outputs[0].text(),
        sourcemap: build.outputs[0].sourcemap ? await build.outputs[0].sourcemap.text() : ''
    };
}

async function applyTerser(script: BunOutput): Promise<boolean> {
    const mini = await minify(script.source, {
        sourceMap: {
            content: script.sourcemap
        },
        toplevel: true,
        // format: {
        //     beautify: true
        // },
        compress: {
            ecma: 2020
        },
        mangle: {
            nth_identifier: nth_identifier,
            properties: {
                reserved: [
                    // stdlib
                    'willReadFrequently',
                    'usedJSHeapSize',

                    // wasm
                    // must be callable:
                    '_abort_js',
                    'emscripten_resize_heap',
                    'fd_close',
                    'fd_seek',
                    'fd_write',
                    // must be an object:
                    'env',
                    'wasi_snapshot_preview1',
                    // is not an object:
                    'instance',
                    // is not a function:
                    'emscripten_stack_init',
                    'emscripten_stack_get_end',
                    '__wasm_call_ctors',
                    // imports:
                    'HEAPU8',
                    // exports:
                    '_emscripten_stack_restore',
                    '_emscripten_stack_alloc',
                    'emscripten_stack_get_current',
                    'memory',
                    '_malloc',
                    'malloc',
                    '_free',
                    'free',
                    '_realloc',
                    'realloc',
                    '__indirect_function_table',
                    '_tsf_load_memory',
                    'tsf_load_memory',
                    '_tsf_close',
                    'tsf_close',
                    '_tsf_reset',
                    'tsf_reset',
                    '_tsf_set_output',
                    'tsf_set_output',
                    '_tsf_channel_set_bank_preset',
                    'tsf_channel_set_bank_preset',
                    '_tml_load_memory',
                    'tml_load_memory',
                    '_midi_render',
                    'midi_render',
                    'setValue',
                    'getValue',
                    'calledRun',

                    // dns-json response fields
                    'Status',
                    'Answer',

                    // main thread <-> ondemand worker protocol
                    'type',
                    'versions',
                    'crcs',
                    'host',
                    'secured',
                    'ingame',
                    'dbEnabled',
                    'archive',
                    'file',
                    'priority',
                    'urgent',
                    'data',
                    'message',
                    'failCount',
                    'error',
                    'id'
                ]
            }
        }
    });

    script.source = mini.code ?? '';
    script.sourcemap = mini.map?.toString() ?? '';
    return true;
}

// ----

if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
}

fs.copyFileSync('src/3rdparty/tinymidipcm/tinymidipcm.wasm', 'out/tinymidipcm.wasm');

const args = process.argv.slice(2);
const prod = args[0] !== 'dev';

const entrypoints = [
    'src/client/Client.ts',
    'src/mapview/MapView.ts',
    'src/io/OnDemandWorker.ts'
];

for (const file of entrypoints) {
    const output = path.basename(file).replace('.ts', '.js').toLowerCase();

    const script = await bunBuild(file, [], prod, prod ? ['console'] : []);
    if (script) {
        if (prod) {
            await applyTerser(script);
        }

        fs.writeFileSync(`out/${output}`, script.source);
        fs.writeFileSync(`out/${output}.map`, script.sourcemap);
    }
}
