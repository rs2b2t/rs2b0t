import { expect, test } from 'bun:test';
import ObjType from '#/client/config/ObjType.js';
import Model from '#/client/dash3d/Model.js';
import Pix3D from '#/client/dash3d/Pix3D.js';
import LruCache from '#/client/datastruct/LruCache.js';
import Pix2D from '#/client/graphics/Pix2D.js';
import type Pix32 from '#/client/graphics/Pix32.js';
import { stubProps } from '../../lib/stubSingletons.js';

test('stack count changes reuse one sprite cache slot and preserve LRU eviction', () => {
    const model = new Model();
    model.objRender = () => {};
    const ordinary = new ObjType();
    const stack = new ObjType();
    ordinary.getModelLit = stack.getModelLit = () => model;
    stack.stackable = true;
    stack.countobj = new Uint16Array(10);
    stack.countco = new Uint16Array(10);

    const cache = new LruCache<Pix32>(200);
    const restore = stubProps(ObjType, { spriteCache: cache, list: id => id === 1 ? stack : ordinary });
    const previous2D = { ...Pix2D };
    const lowDetail = Pix3D.lowDetail;
    try {
        const original = ObjType.getSprite(0, 1, 0);
        for (let count = 1; count <= 200; count++) ObjType.getSprite(1, count, 0);

        expect(cache.history.size()).toBe(2);
        expect(cache.available).toBe(198);
        expect(original).not.toBeNull();
        expect(original?.ohi).toBe(-1);
        expect(ObjType.getSprite(0, 2, 0)).toBe(original);
        expect(cache.find(1n)?.ohi).toBe(200);

        for (let id = 2; id < 200; id++) ObjType.getSprite(id, 1, 0);
        expect(cache.available).toBe(0);
        expect(ObjType.getSprite(0, 1, 0)).toBe(original);
        const newest = ObjType.getSprite(200, 1, 0);
        expect(cache.find(1n)).toBeNull();
        expect(cache.find(0n)).toBe(original);
        expect(cache.find(200n)).toBe(newest);
        expect(cache.history.size()).toBe(200);
    } finally {
        restore();
        Object.assign(Pix2D, previous2D);
        Pix3D.lowDetail = lowDetail;
    }
});

test('models and sprites use the last qualifying nonzero threshold, including item ID 0', () => {
    const variant = new ObjType();
    variant.id = 0;
    variant.model = 42;
    variant.stackable = true;
    variant.countobj = Uint16Array.of(2);
    variant.countco = Uint16Array.of(1);
    const stack = new ObjType();
    stack.id = 1;
    stack.countobj = new Uint16Array(10).fill(2);
    stack.countco = new Uint16Array(10);
    stack.countco[0] = 8;
    stack.countco[8] = 3;
    stack.countobj[8] = 0;
    const objects = [variant, stack, new ObjType()];
    const model = new Model();
    model.objRender = () => {};
    const restoreModel = stubProps(Model, { load: id => id === 42 ? model : null });
    const restoreObj = stubProps(ObjType, { list: id => objects[id], modelCache: new LruCache<Model>(3) });
    const previous2D = { ...Pix2D };
    const lowDetail = Pix3D.lowDetail;
    try {
        for (const count of [3, 8]) {
            expect(stack.getModelUnlit(count)).toBe(model);
            expect(stack.getModelLit(count)).toBe(model);
            const icon = ObjType.getSprite(stack.id, count, -1);
            expect(icon?.owi).toBe(33);
            expect(icon?.ohi).toBe(count);
        }
    } finally {
        restoreObj();
        restoreModel();
        Object.assign(Pix2D, previous2D);
        Pix3D.lowDetail = lowDetail;
    }
});
