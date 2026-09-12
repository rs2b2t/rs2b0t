import fs from 'fs';

import { buildIdentityDefines, resolveBuildIdentity, writeVersionJson } from './tools/lib/buildIdentity.js';

// Build src/bot/main.ts as botclient.js, keeping console output.
// Why: external scripts and self-tests use ABI property names, so skip terser; Bun only shortens locals.

const TARGET_NAME = process.env.TARGET ?? 'local';

// 1024-bit RSA keys, exponent 65537.
// Local matches the engine's private.pem; override with LOCAL_RSAE/LOCAL_RSAN. Live uses LIVE_RSAN.
const TARGET_RSA: Record<string, { rsae: string; rsan: string }> = {
    local: {
        rsae: process.env.LOCAL_RSAE ?? '65537',
        rsan: process.env.LOCAL_RSAN ?? '135523076496100112838368820296627333081299340012903560093710594598681655098748405760144616526347126272127045237860467661349157596468705435014708178676542187051745346055229544524388140867808854007219907874939518784380039390430841371837588073879981616508242779530473286487605800927487856120184640386127488369021'
    },
    live: {
        rsae: '65537',
        rsan: process.env.LIVE_RSAN ?? ''
    },
    // prod runs on the game server; ops/scripts/build.sh supplies PROD_RSAN from client.js.
    prod: {
        rsae: '65537',
        rsan: process.env.PROD_RSAN ?? ''
    }
};

if (!(TARGET_NAME in TARGET_RSA)) {
    console.error(`Unknown TARGET '${TARGET_NAME}'. Valid: ${Object.keys(TARGET_RSA).join(', ')}.`);
    process.exit(1);
}

const rsa = TARGET_RSA[TARGET_NAME] ?? TARGET_RSA.local;
if ((TARGET_NAME === 'live' || TARGET_NAME === 'prod') && rsa.rsan === '') {
    const envVar = TARGET_NAME === 'live' ? 'LIVE_RSAN' : 'PROD_RSAN';
    console.error(`TARGET=${TARGET_NAME} requires ${envVar} (rs2b2t rotated modulus). Aborting.`);
    process.exit(1);
}

const identity = resolveBuildIdentity();

const define = {
    'process.env.SECURE_ORIGIN': JSON.stringify(process.env.SECURE_ORIGIN ?? 'false'),
    'process.env.RS2B0T_TARGET': JSON.stringify(TARGET_NAME),
    'process.env.LOGIN_RSAE': JSON.stringify(rsa.rsae),
    'process.env.LOGIN_RSAN': JSON.stringify(rsa.rsan),
    // Config decoders enable strict mode only for '1'.
    'process.env.STRICT_PACKETS': JSON.stringify(process.env.STRICT_PACKETS ?? ''),
    'process.env.STRICT_CONFIG': JSON.stringify(process.env.STRICT_CONFIG ?? ''),
    ...buildIdentityDefines(identity)
};

const args = process.argv.slice(2);
const prod = args[0] !== 'dev';

if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
}

fs.copyFileSync('src/client/3rdparty/tinymidipcm/tinymidipcm.wasm', 'out/tinymidipcm.wasm');

const entrypoints: [entry: string, output: string][] = [
    ['src/bot/main.ts', 'botclient.js'],
    ['src/bot/multibox/main.ts', 'multibox.js'],
    ['src/client/io/OnDemandWorker.ts', 'ondemandworker.js'],
    ['src/bot/event/webwalk/NavWorker.ts', 'navworker.js']
];

for (const [entry, output] of entrypoints) {
    const build = await Bun.build({
        entrypoints: [entry],
        sourcemap: 'external',
        define,
        minify: prod
    });

    if (!build.success) {
        build.logs.forEach((x: unknown) => console.log(x));
        process.exit(1);
    }

    let source = await build.outputs[0].text();
    const sourcemap = build.outputs[0].sourcemap ? await build.outputs[0].sourcemap.text() : '';

    // the bundle is renamed on disk; keep the sourcemap pointer in sync
    const generatedName = build.outputs[0].path.split('/').pop()!;
    source = source.replace(`sourceMappingURL=${generatedName}.map`, `sourceMappingURL=${output}.map`);

    fs.writeFileSync(`out/${output}`, source);
    fs.writeFileSync(`out/${output}.map`, sourcemap);
}

writeVersionJson('out/version.json', identity);
console.log(
    `bot bundle built (${prod ? 'prod' : 'dev'}): out/botclient.js  git=${identity.dirty ? `${identity.short}-dirty` : identity.short}`
);
