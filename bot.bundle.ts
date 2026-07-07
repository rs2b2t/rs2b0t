import fs from 'fs';

// LCBuddy2 build (H7) — clone of bundle.ts with three deliberate differences:
//   1. entrypoint is src/bot/main.ts (the bot client), emitted as botclient.js
//   2. NO terser pass and therefore NO property mangling: the bot API surface
//      (globalThis.__lcbuddy, Slice 7) keeps stable property names for
//      externally-compiled scripts, and string-keyed self-test checks work
//   3. console is always kept — bot logs matter
// Bun's own minifier (prod) shortens locals but never mangles property names.

const TARGET_NAME = process.env.TARGET ?? 'local';

// PUBLIC login keys per target. local = upstream default (matches the local
// engine's committed private.pem). live = rs2b2t's rotated key; its 1024-bit
// modulus is a PUBLIC value supplied via LIVE_RSAN at live-build time
// (extract from prod: see docs/superpowers/plans — Task 2 note).
const TARGET_RSA: Record<string, { rsae: string; rsan: string }> = {
    local: {
        rsae: '58778699976184461502525193738213253649000149147835990136706041084440742975821',
        rsan: '7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789'
    },
    live: {
        rsae: '65537',
        rsan: process.env.LIVE_RSAN ?? ''
    }
};

const rsa = TARGET_RSA[TARGET_NAME] ?? TARGET_RSA.local;
if (TARGET_NAME === 'live' && rsa.rsan === '') {
    console.error('TARGET=live requires LIVE_RSAN (rs2b2t rotated modulus). Aborting.');
    process.exit(1);
}

const define = {
    'process.env.SECURE_ORIGIN': JSON.stringify(process.env.SECURE_ORIGIN ?? 'false'),
    'process.env.RS2B0T_TARGET': JSON.stringify(TARGET_NAME),
    'process.env.LOGIN_RSAE': JSON.stringify(rsa.rsae),
    'process.env.LOGIN_RSAN': JSON.stringify(rsa.rsan),
    'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString())
};

const args = process.argv.slice(2);
const prod = args[0] !== 'dev';

if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
}

fs.copyFileSync('src/3rdparty/tinymidipcm/tinymidipcm.wasm', 'out/tinymidipcm.wasm');

const entrypoints: [entry: string, output: string][] = [
    ['src/bot/main.ts', 'botclient.js'],
    ['src/bot/multibox/main.ts', 'multibox.js'],
    ['src/io/OnDemandWorker.ts', 'ondemandworker.js'],
    ['src/bot/nav/NavWorker.ts', 'navworker.js']
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

console.log(`bot bundle built (${prod ? 'prod' : 'dev'}): out/botclient.js`);
