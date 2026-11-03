import { expect, test } from 'bun:test';
import { selectTarget, lootPriority, type TargetCandidate } from '../../src/bot/scripts/JiveTT/huntLogic.js';
import { selectEquipment, damageMode } from '../../src/bot/scripts/JiveTT/equipment.js';
import { compareLoot } from '../../src/bot/scripts/JiveTT/loot.js';
import { DEFAULT_SETTINGS } from '../../src/bot/scripts/JiveTT/settings.js';

const dragon: TargetCandidate = { index: 1, id: 55, distance: 4, chance: 1 / 128, killSeconds: 35, reachable: true, engaged: false, valid: true };
const demon: TargetCandidate = { ...dragon, index: 2, id: 83, distance: 2, killSeconds: 20 };

test('mixed camps choose a reachable free species while retaining the current fight', () => {
    expect(selectTarget([dragon, demon], null)?.index).toBe(2);
    expect(selectTarget([dragon, demon], 1)?.index).toBe(1);
    expect(selectTarget([dragon, { ...demon, reachable: false }], null)?.index).toBe(1);
    expect(selectTarget([{ ...dragon, engaged: true }, { ...demon, reachable: false }], null)).toBeNull();
});

test('clues precede selected loot and optional bones regardless of keepItems', () => {
    expect(lootPriority({ clue: true, selected: false, bones: false, rare: false })).toBeGreaterThan(lootPriority({ clue: false, selected: true, bones: false, rare: true }));
    expect(lootPriority({ clue: false, selected: false, bones: false, rare: false })).toBe(0);
});

test('selected rare drops precede hides and burying bones', () => {
    expect([536, 1751, 985].sort((a, b) => compareLoot(a, b, { ...DEFAULT_SETTINGS, keepItems: ['985'] }))).toEqual([985, 1751, 536]);
});

test('owned equipment selection respects quest gates and keeps a dragonfire shield', () => {
    const stock = [1305, 1333, 1127, 1113, 1079, 1163, 1540].map(id => ({ id, count: 1 }));
    const kit = selectEquipment(stock, { attack: 70, defence: 70 }, [], true);
    expect(kit.kind).toBe('ready');
    if (kit.kind === 'ready') { expect(kit.weapon.id).toBe(1333); expect(kit.items).toContain(1540); expect(kit.items).toContain(1113); expect(kit.items).not.toContain(1127); }
    const dragonKit = selectEquipment(stock, { attack: 70, defence: 70 }, ['Lost City', 'Dragon Slayer'], true);
    if (dragonKit.kind === 'ready') expect(dragonKit.weapon.id).toBe(1305);
    expect(selectEquipment(stock.filter(i => i.id !== 1540), { attack: 70, defence: 70 }, [], true).kind).toBe('blocked');
});

test('dragon longsword uses stab against the actual lower dragon stab defence', () => {
    expect(damageMode('Dragon longsword', { stab: 50, slash: 70, crush: 70 })).toBe(2);
    expect(damageMode('Rune scimitar', { stab: 0, slash: 0, crush: 0 })).toBe(1);
});

test('weapon bonuses prevent choosing a weak stab mode just for lower target defence', () => {
    expect(damageMode('Rune scimitar', { stab: 50, slash: 70, crush: 70 })).toBe(1);
});
