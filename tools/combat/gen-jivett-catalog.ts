import { readFileSync, writeFileSync } from 'node:fs';
import { buildCatalog } from './jivett-catalog.js';

const content = process.env.CONTENT_DIR;
if (!content) throw new Error('Set CONTENT_DIR to the revision 289 content checkout');
const output = 'src/bot/scripts/JiveTT/lootData.ts';
const { entries, hash } = buildCatalog(content);
const text = `/* eslint-disable */\nexport const CONTENT_HASH = ${JSON.stringify(hash)};\nexport const LOOT_DATA = [\n${entries.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n];\n`;
if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== text) throw new Error(`${output} differs from the content drop tables`);
    console.log(`Verified ${entries.length} JiveTT loot identities (${hash})`);
} else {
    writeFileSync(output, text);
    console.log(`Wrote ${entries.length} JiveTT loot identities (${hash})`);
}
