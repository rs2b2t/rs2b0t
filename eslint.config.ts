import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Why: flat config replaces rule options rather than merging them, so a later `no-restricted-imports` block for a path repeals every earlier one — every fence below must carry CLIENT_INTERNALS.
const CLIENT_INTERNALS = {
    group: ['\\#/client/*/*', '!\\#/client/io/ServerProt.js', '!\\#/client/io/ClientProt.js', '!\\#/client/dash3d/CollisionFlag.js', '!\\#/client/shell/MiniMenuAction.js', '!\\#/client/mapview/worldmapKeyNames.js'],
    message: 'Only src/bot/adapter/ may touch client internals.'
};

/** main.ts pulls in panel/ and the runtime — a leaf layer reaching it is a cycle. */
const APP_ENTRYPOINT = {
    group: ['**/main.js'],
    message: 'main.ts is the app entrypoint — a leaf layer must not import it.'
};

export default defineConfig([
    globalIgnores(['src/client/3rdparty/', 'out/', 'desktop/', 'packages/', 'docs/script-template/', 'public-bot/', '.claude/', 'identifier.js']),
    { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], plugins: { js }, extends: ['js/recommended'], languageOptions: { globals: globals.browser } },
    tseslint.configs.recommended,
    {
        rules: {
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],

            'no-constant-condition': ['error', { checkLoops: false }],
            'no-case-declarations': 'error',
            '@typescript-eslint/no-namespace': 'error',
            '@typescript-eslint/no-explicit-any': 'warn',

            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    },

    // Why: the ported 2004 client is a frozen port that swallows exceptions faithfully, so an empty catch there is intent.
    {
        files: ['src/client/**/*.ts', 'src/dash3d/**/*.ts', 'src/graphics/**/*.ts', 'src/mapview/**/*.ts', 'src/config/**/*.ts', 'src/io/**/*.{ts,js}', 'src/sound/**/*.ts', 'src/datastruct/**/*.ts', 'src/wordfilter/**/*.ts'],
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    // ---- rs2b0t fences ----
    // Only adapter/ may name client internals; protocol const-enums are exempt — inlined, no runtime coupling.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/adapter/**', 'src/bot/runtime/BotClient.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [CLIENT_INTERNALS]
                }
            ]
        }
    },
    // Only panel/ and the entrypoints may touch the DOM (keeps headless viable).
    // Why: MultiBox is a second DOM entrypoint, so main.ts and the rail/overlay views are exempted while the rest of src/bot/multibox/ stays fenced.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/panel/**', 'src/bot/main.ts', 'src/bot/multibox/DomSlotOps.ts', 'src/bot/multibox/ProfileChooser.ts', 'src/bot/multibox/SettingsPanel.ts', 'src/bot/multibox/TabBar.ts', 'src/bot/multibox/VaultPrompt.ts', 'src/bot/multibox/main.ts', 'src/bot/runtime/WorkerClock.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'document', message: 'DOM only in src/bot/panel/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,SettingsPanel,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }, { name: 'window', message: 'DOM only in src/bot/panel/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,SettingsPanel,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }]
        }
    },

    // api/ sits above adapter/, event/ and data/, and on the host substrate (Settings, BotHost, Scheduler).
    // Why: it must not reach up into script lifecycle or the layers that consume it.
    {
        files: ['src/bot/api/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: [
                                '**/scripts/**',
                                '**/panel/**',
                                '**/multibox/**',
                                '**/runtime/**',
                                '!**/runtime/Settings.js',
                                '!**/runtime/BotHost.js',
                                '!**/runtime/Scheduler.js'
                            ],
                            message: 'api/ may stand on runtime/{Settings,BotHost,Scheduler} only — never on script lifecycle or the layers that consume it.'
                        }
                    ]
                }
            ]
        }
    },
    // data/ holds inert catalogs: tables plus pure resolvers over them, no live game reads.
    // Why: gitignore semantics cannot re-admit a path under an excluded parent, so geometry/ is a top-level leaf rather than a child of api/.
    {
        files: ['src/bot/data/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['**/api/**', '**/event/**', '**/input/**', '**/paint/**', '**/scripts/**', '**/panel/**', '**/runtime/**', '**/multibox/**', '**/adapter/**'],
                            allowTypeImports: true,
                            message: 'data/ is inert — value imports only from geometry/. Type-only imports are fine.'
                        }
                    ]
                }
            ]
        }
    },
    // abi.ts lives inside runtime/, so its siblings are named './X.js' and a '**/runtime/**' pattern can never match them.
    // Why: deny the sibling directory and re-admit the two entries it needs.
    {
        files: ['src/bot/runtime/abi.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['./*', '!./Settings.js', '!./defineBot.js', '!./buildInfo.js'],
                            message: 'abi.ts may name only runtime/{Settings,defineBot,buildInfo} — never script lifecycle.'
                        },
                        {
                            group: ['**/scripts/**', '**/panel/**', '**/multibox/**'],
                            message: 'abi.ts publishes from api/, data/, geometry/, event/ and the adapter only.'
                        }
                    ]
                }
            ]
        }
    },
    // geometry/ is the one value source data/ may name, so it must stay a leaf —
    // otherwise it launders anything into the "inert" layer.
    {
        files: ['src/bot/geometry/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['**/api/**', '**/event/**', '**/input/**', '**/paint/**', '**/data/**', '**/scripts/**', '**/panel/**', '**/runtime/**', '**/multibox/**', '**/adapter/**'],
                            allowTypeImports: true,
                            message: 'geometry/ is a leaf — no value imports outside it. Type-only imports are fine.'
                        }
                    ]
                }
            ]
        }
    }
]);
