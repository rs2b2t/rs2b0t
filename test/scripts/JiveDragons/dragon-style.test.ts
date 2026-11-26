import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import type { MeleeCombatStyle } from '#/bot/api/combat/CombatStyle.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

function equippedStyle(weapon: string, initial: MeleeCombatStyle = 'strength') {
    let selected = initial;
    spyOn(reader, 'equipment').mockReturnValue([
        { id: 1305, name: weapon, slot: 3, count: 1, ops: ['Remove'], comId: 1 },
        { id: 1540, name: 'Dragonfire shield', slot: 5, count: 1, ops: ['Remove'], comId: 1 }
    ]);
    spyOn(Game, 'hasCombatStyle').mockImplementation(style => style === selected);
    spyOn(Game, 'setCombatStyle').mockImplementation(style => { if (typeof style === 'number') return false; selected = style; return true; });
    return () => selected;
}

test('style task uses the equipped Dragon longsword when Best available selected it', async () => {
    const { task } = await scenario('taverley-blue', 'melee', { weapon: 'Best available' });
    const selected = equippedStyle('Dragon longsword');
    const style = task('SetAttackStyle');
    spyOn(style, 'validate').mockRestore();
    expect(style.validate()).toBe(true);
    await style.execute();
    expect(selected()).toBe('controlled');
});

test('mixed Enclave fights switch stance before attacking dragons and demons', async () => {
    const { fight, dragon, state } = await scenario('gutanoth-blue', 'melee', { weapon: 'Dragon longsword' });
    const selected = equippedStyle('Dragon longsword');
    const styles: MeleeCombatStyle[] = [];
    spyOn(Npc.prototype, 'interact').mockImplementation(() => { styles.push(selected()); return true; });
    dragon.inCombat = false;
    await fight['engage'](new Npc(dragon), 'Blue dragon');
    const demon = { ...dragon, index: 18, name: 'Greater demon' };
    state.npcs = [demon];
    await fight['engage'](new Npc(demon), 'Greater demon');
    expect(styles).toEqual(['controlled', 'strength']);
});

test('a configured Dragon longsword does not override another equipped weapon', async () => {
    const { task } = await scenario('taverley-blue', 'melee', { weapon: 'Dragon longsword', meleeStyle: 'attack' });
    const selected = equippedStyle('Rune scimitar');
    await task('SetAttackStyle').execute();
    expect(selected()).toBe('attack');
});

for (const failure of ['refused', 'unconfirmed']) {
    test(`does not attack a dragon when controlled style is ${failure}`, async () => {
        const { engage, state } = await scenario('taverley-blue', 'melee', { weapon: 'Dragon longsword' });
        equippedStyle('Dragon longsword');
        spyOn(Game, 'setCombatStyle').mockReturnValue(failure !== 'refused');
        spyOn(Execution, 'delayUntil').mockResolvedValue(false);
        expect(await engage()).toBe(false);
        expect(state.attacks).toBe(0);
    });
}
