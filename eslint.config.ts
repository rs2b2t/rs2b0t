import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Why: flat config replaces rule options, so every no-restricted-imports block must include CLIENT_INTERNALS.
const CLIENT_INTERNALS = {
    group: ['\\#/client/*/*', '!\\#/client/io/ServerProt.js', '!\\#/client/io/ClientProt.js', '!\\#/client/dash3d/CollisionFlag.js', '!\\#/client/shell/MiniMenuAction.js', '!\\#/client/mapview/worldmapKeyNames.js'],
    message: 'Only src/bot/adapter/ may touch client internals.'
};

/** Why: main.ts imports the panel and runtime; importing it from a lower layer creates a cycle. */
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

    // Why: the 2004 client deliberately ignores some exceptions.
    {
        files: ['src/client/**/*.ts', 'src/dash3d/**/*.ts', 'src/graphics/**/*.ts', 'src/mapview/**/*.ts', 'src/config/**/*.ts', 'src/io/**/*.{ts,js}', 'src/sound/**/*.ts', 'src/datastruct/**/*.ts', 'src/wordfilter/**/*.ts'],
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    // Only adapter/ may import client internals; inlined protocol enums are exempt.
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
    // Why: DOM access is limited to the panel and entrypoints to support headless runs.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/panel/**', 'src/bot/main.ts', 'src/bot/multibox/DomSlotOps.ts', 'src/bot/multibox/ProfileChooser.ts', 'src/bot/multibox/SettingsPanel.ts', 'src/bot/multibox/TabBar.ts', 'src/bot/multibox/VaultPrompt.ts', 'src/bot/multibox/main.ts', 'src/bot/runtime/WorkerClock.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'document', message: 'DOM only in src/bot/panel/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,SettingsPanel,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }, { name: 'window', message: 'DOM only in src/bot/panel/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,SettingsPanel,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }]
        }
    },

    // api/ may use adapter/, event/, data/ and these runtime helpers, but not scripts or UI.
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
    // data/ has tables and pure helpers, with geometry/ as its only value dependency.
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
    // Why: '**/runtime/**' misses sibling imports, so restrict './*' and allow these three helpers.
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
    // Why: data/ imports geometry/, so geometry/ must stay independent of game state.
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
