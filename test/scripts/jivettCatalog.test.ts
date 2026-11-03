import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog, MONSTERS } from '../../tools/combat/jivett-catalog.js';
import { LOOT_CATALOG, lootIdentity, lootPolicy, missingLootIds } from '../../src/bot/scripts/JiveTT/loot.js';
import { DEFAULT_SETTINGS } from '../../src/bot/scripts/JiveTT/settings.js';
import { SITES, siteRequirements } from '../../src/bot/scripts/JiveTT/sites.js';

test('full loot identities distinguish hides, key halves, herbs and notes', () => {
    for (const id of [1751,1749,1747,985,987,199,201,203,205,207,209,211,213,215,217,2485,3810,4087,2366,1615,526,536,592]) expect(lootIdentity(id)).toBeDefined();
    expect(lootIdentity(1751)?.label).toBe('Blue dragonhide');
    expect(lootIdentity(1749)?.label).toBe('Red dragonhide');
    expect(lootIdentity(985)?.label).not.toBe(lootIdentity(987)?.label);
    expect(lootIdentity(443)?.id).toBe(442);
    expect(lootIdentity(449)?.default).toBe(true);
    expect(lootIdentity(2366)?.default).toBe(true);
    expect(new Set(LOOT_CATALOG.map(item => item.id)).size).toBe(LOOT_CATALOG.length);
});

test('bone and hide policy is authoritative over optional keep items', () => {
    expect(lootPolicy(536, { ...DEFAULT_SETTINGS, keepItems: ['536'], dragonBones: 'bury' })).toBe('bury');
    expect(lootPolicy(1751, { ...DEFAULT_SETTINGS, keepItems: [], dragonHides: 'bank' })).toBe('keep');
    expect(lootPolicy(1751, { ...DEFAULT_SETTINGS, keepItems: ['1751'], dragonHides: 'leave' })).toBe('leave');
});

test('recursive drop coverage sees new shared items and the default death drop', () => {
    const root = mkdtempSync(join(tmpdir(), 'jivett-catalog-'));
    try {
        mkdirSync(join(root, 'pack'), { recursive: true });
        mkdirSync(join(root, 'scripts/drop tables/scripts'), { recursive: true });
        writeFileSync(join(root, 'pack/obj.pack'), '526=bones\n9000=new_item\n9001=cert_new_item\n');
        writeFileSync(join(root, 'scripts/items.obj'), '[bones]\nname=Bones\n[new_item]\nname=New item\n');
        writeFileSync(join(root, 'scripts/drop.param'), '[death_drop]\ntype=namedobj\ndefault=bones\n');
        writeFileSync(join(root, 'scripts/npcs.npc'), MONSTERS.map(name => `[${name}]\nname=${name}`).join('\n'));
        for (const name of MONSTERS) writeFileSync(join(root, 'scripts/drop tables/scripts', `${name}.rs2`), `[ai_queue3,${name}]\nobj_add(npc_coord,npc_param(death_drop),1,0);\nobj_add(npc_coord,~randomjewel,0);\n`);
        writeFileSync(join(root, 'scripts/drop tables/scripts/shared_droptables.rs2'), '[proc,randomjewel]()(namedobj,int)\nreturn(~ultrarare_getitem);\n[proc,ultrarare_getitem]()(namedobj,int)\nreturn(~megararetable);\n[proc,megararetable]()(namedobj,int)\n$drop=cert_new_item;\nreturn($drop,1);\n');
        const result = buildCatalog(root);
        expect(result.entries.map(item => item.id)).toEqual([526, 9000]);
        expect(result.entries[1].noteIds).toEqual([9001]);
        expect(result.entries[1].sources).toEqual(MONSTERS);
        expect(missingLootIds(result.entries.map(item => item.id))).toEqual([9000]);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only accepted Taverley blues are enabled and enclave excludes caged demons', () => {
    expect(SITES.length).toBe(11);
    expect(SITES.filter(site => site.validation !== null).map(site => site.id)).toEqual(['taverley-blue']);
    const blue = SITES.find(site => site.id === 'taverley-blue')!;
    expect(blue.validation?.evidence).toContain('jivett-hunt-probe-mvzugyz3');
    expect(blue.validation?.npcIds).toEqual([55]);
    expect(DEFAULT_SETTINGS.allowedSites).toEqual(['taverley-blue']);
    const enclave = SITES.find(site => site.id === 'gutanoth')!;
    expect(enclave.targets.find(target => target.name === 'Greater demon')?.spawnTiles).toEqual([{ x: 2586, z: 9458, level: 0 }]);
    const claimed = { ...enclave, validation: { revision: '289', evidence: 'fixture', entry: true, melee: true, loot: true, exit: true, npcIds: [55] } };
    expect(siteRequirements(claimed, { account: 'fixture', world: 1, bankFresh: true, inventory: [], bank: [{ id: 1540, count: 1 }], equipment: [], levels: { attack: 99, defence: 99, prayer: 99, magic: 99 }, quests: ['Watch Tower'], weaponId: 1305, escapeReady: true, suppliesReady: true })).toContain('local entry, melee, loot and exit validation');
});
