import { ITEM_DB } from '../../data/itemdb.js';
import type { Stock } from './policy.js';

export const CHEST_LOOT = new Set([
    1071, 1073, 1077, 1083, 1085, 1091, 1097, 1105, 1107, 1109, 1111, 1113, 1121, 1123, 1125,
    1141, 1143, 1145, 1147, 1151, 1159, 1161, 1165, 1179, 1181, 1183, 1193, 1195, 1197, 1199,
    1209, 1211, 1217, 1225, 1227, 1233, 1241, 1243, 1245, 1255, 1257, 1259, 1281, 1283, 1285,
    1287, 1289, 1295, 1297, 1299, 1301, 1303, 1311, 1313, 1315, 1317, 1325, 1327, 1329, 1331,
    1333, 1339, 1341, 1343, 1345, 1353, 1357, 1361, 1365, 1367, 1369, 1371, 1381, 1383, 1385,
    1387, 1389, 1391, 1424, 1426, 1428, 1637, 1639, 1641, 1643, 1725, 1727, 1729, 1731,
    2355, 2357, 2359, 2361, 3678
]);

export const ALCH_VALUES = new Map(ITEM_DB.filter(item => CHEST_LOOT.has(item.id)).map(item => [item.id, Math.floor(item.cost * 0.6)]));
ALCH_VALUES.set(3678, 6000);

export function lootBaseline(before: Stock, inventory: Stock, worn: ReadonlySet<number>): Stock {
    const baseline = new Map(before);
    for (const [id, count] of inventory) {
        if (!CHEST_LOOT.has(id) || worn.has(id)) baseline.set(id, count);
        else if (id === 3678) baseline.set(id, Math.max(1, before.get(id) ?? 0));
    }
    return baseline;
}
