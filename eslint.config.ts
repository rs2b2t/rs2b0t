import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['src/3rdparty/', 'out/', 'desktop/', 'packages/', 'templates/', 'public-bot/', '.claude/', 'identifier.js']),
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

    // ---- rs2b0t fences ----
    // Only adapter/ may name client internals; everything else in src/bot/
    // imports the adapter. Protocol const-enums are exempt (inlined, no
    // runtime coupling).
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/adapter/**', 'src/bot/BotClient.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['#/client/*', '#/io/*', '#/config/*', '#/dash3d/*', '#/datastruct/*', '#/graphics/*', '#/sound/*', '#/wordfilter/*', '#3rdparty/*', '!#/io/ServerProt.js', '!#/io/ClientProt.js', '!#/dash3d/CollisionFlag.js'],
                            message: 'Only src/bot/adapter/ may touch client internals.'
                        }
                    ]
                }
            ]
        }
    },
    // Only ui/ and the entrypoints may touch the DOM (keeps headless viable).
    // The MultiBox manager is a second DOM entrypoint: main.ts (its bundle
    // entry) and DomSlotOps.ts (its DOM-ops layer, analogous to ui/) are
    // exempted the same way; the rest of src/bot/multibox/ stays fenced.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/ui/**', 'src/bot/main.ts', 'src/bot/multibox/DomSlotOps.ts', 'src/bot/multibox/main.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'document', message: 'DOM only in src/bot/ui/, main.ts, and src/bot/multibox/{DomSlotOps,main}.ts.' }, { name: 'window', message: 'DOM only in src/bot/ui/, main.ts, and src/bot/multibox/{DomSlotOps,main}.ts.' }]
        }
    }
]);
