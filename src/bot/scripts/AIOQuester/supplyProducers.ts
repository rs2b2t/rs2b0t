import { STAND } from '../../api/thieving/cakeStallData.js';
import Tile from '../../geometry/Tile.js';
import { combatPlan } from '../AccountLeveler/combat.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement, type SessionMemory } from '../AccountLeveler/types.js';
import { ARENA_ENTRANCE, TICKET_NAME, TRIP_COINS } from '../BrimhavenAgility/BrimhavenAgilityLogic.js';

export function questSupplyProducer(s: LevelerSnapshot, need: Requirement, memory: SessionMemory, random: () => number): ActivityPlan | null {
    switch (need.item.toLowerCase()) {
        case 'agility potion(3)': {
            const missing = need.count - stockOf(s, need.item);
            const unfinished = Math.min(missing, stockOf(s, '#3002'));
            const herbs = missing - unfinished;
            return { id: 'quest-agility-potions', label: 'Brew Agility potions', objective: 'herblore', script: 'PotionMaker',
                settings: { herb: 'Toadflax', secondary: "Toad's legs", outputId: 3034, outputCount: need.count }, output: { item: need.item, count: need.count },
                needs: [
                    ...herbs > 0 ? [{ item: 'Toadflax', count: herbs, carry: 0 }, { item: 'Vial of water', count: herbs, carry: 0 }] : [],
                    ...unfinished > 0 ? [{ item: 'Unfinished potion', id: 3002, count: unfinished, carry: 0 }] : [],
                    { item: "Toad's legs", count: missing, carry: 0 }
                ] };
        }
        case 'toadflax': {
            const tickets = (need.count - stockOf(s, 'Toadflax')) * 3;
            return { id: 'quest-toadflax', label: 'Trade Brimhaven tickets for Toadflax', objective: 'supplies', script: 'QuestToadflax',
                settings: {}, travel: Tile.from(ARENA_ENTRANCE), output: { item: 'Toadflax', count: need.count },
                needs: [{ item: TICKET_NAME, count: tickets, carry: tickets }, { item: 'Coins', count: 60, carry: 60 }] };
        }
        case 'agility arena ticket':
            return { id: 'quest-arena-tickets', label: 'Earn Brimhaven Agility tickets', objective: 'agility', script: 'QuestArenaTickets',
                settings: { count: need.count, food: 'Lobster', foodWithdraw: 12, bankAtTickets: need.count, stealRestock: false },
                food: 'Lobster', output: { item: TICKET_NAME, count: need.count },
                needs: [{ item: 'Coins', count: TRIP_COINS, carry: TRIP_COINS }, { item: 'Lobster', count: 12, carry: 12 }] };
        case "toad's legs":
            return { id: 'quest-toad-legs', label: 'Gather swamp toad legs', objective: 'supplies', script: 'HerbloreSecondaries',
                settings: { secondary: "Toad's legs", foodWithdraw: 0 }, needs: [], output: { item: "Toad's legs", count: need.count } };
        case 'cake':
            return { id: 'quest-cakes', label: 'Steal quest cakes', objective: 'thieving', script: 'QuestCakeSupply',
                settings: { count: need.count }, needs: [], travel: STAND, output: { item: 'Cake', count: need.count } };
        case 'seaweed':
            return { id: 'quest-seaweed', label: 'Gather coastal seaweed', objective: 'supplies', script: 'QuestGroundSupply',
                settings: { item: 'Seaweed' }, needs: [], travel: new Tile(2708, 3728, 0), output: { item: 'Seaweed', count: need.count } };
        case 'bat bones': {
            const plan = combatPlan(s, 'attack', memory, random);
            if (!plan) return null;
            const tile = new Tile(2589, 3478, 0);
            return { ...plan, id: 'quest-bat-bones', label: 'Gather Giant bat bones', travel: tile,
                output: { item: 'Bat bones', count: need.count },
                settings: { ...plan.settings, target: 'Giant bat', coordinates: tile,
                    loot: ['Bat bones'], buryBones: false, buryBigBones: false } };
        }
        default: return null;
    }
}
