import { afterEach, expect, spyOn, test } from 'bun:test';
import { attach, detach } from '#/bot/adapter/ClientAdapter.js';
import { foodCount } from '#/bot/api/combat/food.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import ObjType from '#/client/config/ObjType.js';

const interfaces = IfType.list;
afterEach(() => { detach(); IfType.list = interfaces; spyOn(ObjType, 'list').mockRestore(); });

for (const bank of [false, true]) {
    test(`inventory food counts distinguish notes with the bank ${bank ? 'open' : 'closed'}`, () => {
        IfType.list = [];
        const root = new IfType();
        root.id = 300;
        root.type = ComponentType.TYPE_LAYER;
        root.children = [301];
        const pack = new IfType();
        pack.id = 301;
        pack.type = ComponentType.TYPE_INV;
        pack.objOps = true;
        pack.iop = bank ? ['Deposit-All'] : null;
        pack.linkObjType = new Int32Array([381, 380]);
        pack.linkObjNumber = new Int32Array([100, 1]);
        IfType.list[300] = root;
        IfType.list[301] = pack;
        const main = new IfType();
        main.id = 200;
        main.type = ComponentType.TYPE_INV;
        main.iop = ['Withdraw-1'];
        IfType.list[200] = main;
        attach({ mainModalId: bank ? 200 : -1, sideModalId: bank ? 300 : -1, sideIcon: [-1, -1, -1, 300] });
        spyOn(ObjType, 'list').mockImplementation(id => {
            const type = new ObjType();
            type.id = id;
            type.name = 'Lobster';
            type.certtemplate = id === 380 ? 799 : -1;
            type.iop = id === 380 ? [] : ['Eat'];
            return type;
        });
        expect(Inventory.items()).toHaveLength(2);
        expect(foodCount(Inventory.items(), 'Lobster')).toBe(1);
    });
}
