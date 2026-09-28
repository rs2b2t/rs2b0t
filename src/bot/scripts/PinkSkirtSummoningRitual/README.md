# Pink Skirt Summoning Ritual

Bank your inventory, pickpocket skirt money, and don the sacred pink skirt with no setup required. Join other initiates in leaderless synchronized formations while late arrivals await the next cycle and ordinary passersby are ignored. The Cult of the Pink Hem demands no leader, only matching skirts and a suspicious commitment to geometry.

Select **Pink Skirt Summoning Ritual** in the built-in script list and start it on each logged-in account in the same world. There are no script parameters, account lists, leaders, relays, or shared clocks to configure. All participants must use the same version.

Version **1.1.0** starts by walking to the nearest usable bank and depositing **all inventory items**, including coins and any unequipped skirt. Equipped items stay equipped. It confirms an empty inventory and closes the bank before continuing; failed deposits retry. It then pickpockets a Lumbridge Man until it holds at least 5 gp, buys and equips a Pink skirt from Thessalia if needed, and starts checking formation destinations at Lumbridge. An already equipped skirt is reused. Failed pickpockets allow for the stun; low health waits for regeneration. Shop stock is shared, so a large batch of fresh accounts can take time to acquire skirts.

At each stop, up to **16 recognized participants** form a group. A full existing group keeps its places. Extra arrivals go to the next WalkTo destination, wrapping back to Lumbridge after Yanille. Simultaneous arrivals use the same deterministic capacity calculation. Smaller groups perform the occupied part of each pattern; there is no minimum group size. Groups stay at a working destination; this is not an automatic city tour.

## Patterns and timing

North is at the top; each character is one tile. The performance area is 5×5.

```text
 Plus      Cross     Filled 3x3   Outline 5x5    Dot
 ..#..     #...#       .....         #####       .....
 ..#..     .#.#.       .###.         #...#       .....
 #####     ..#..       .###.         #...#       ..#..
 ..#..     .#.#.       .###.         #...#       .....
 ..#..     #...#       .....         #####       .....
```

The cycle is **plus → cross → filled 3×3 → outlined 5×5 → dot**. The star is removed. Plus, cross and the filled square occupy nine tiles; extra accounts share tiles. The complete outline needs 16 accounts. The dot stacks everyone at offset **(0,0)**. With fewer accounts, unused slots are absent. Normalized names choose tile assignments; names never give an account authority over the others.

Each finished symbol holds for **nine game ticks**, approximately **5.4 seconds** on a 600 ms server. Exactly five seconds cannot be expressed as a whole number of those ticks. Movement and reassembly take additional time; the hold starts when every current member reaches its assigned tile. The script sends one-tile steps so differing run energy does not change formation speed.

## How leaderless synchronization works

1. Each account independently reads the same nearby pink-skirt appearances and server positions. It uses server movement route heads, not interpolated sprites.
2. Newcomers identify themselves with a short, held **6 → 5 → 6 → 5 → 6** movement sequence in the north entry lane, then wait at offset (0,6). Late observers recognize existing dancers through successive held pattern positions. During admission, a deliberate approach and wait at assembly also lets newcomers recognize peers whose earlier entry sequence they missed. Merely wearing pink, passing through, or already standing at a queue/assembly tile does not establish membership.
3. The active roster stays fixed for the entire pattern cycle. Recognized arrivals wait until the dot finishes. If there is space, the group gathers once at the shared assembly tile to admit the waiting batch, then starts the next cycle. With no arrivals, it goes straight back to plus without assembling.
4. The assembly timer starts when the selected roster is physically together, independently of when each account joined. Every account observes completed patterns and counts nine received game ticks. A delayed observer can catch a transition visible in other members' positions. No account sends commands to another.
5. Only roster members can request recovery by returning to assembly. Missing members get a three-tick grace period before removal and reassembly. A missed local update or stalled formation also triggers recovery. Losing the first alphabetical account has no special effect.

The assembly tile and entry queue are four and six tiles north of the centre, outside the 5×5 performance square. New arrivals do not interrupt the current cycle. A newcomer may first observe a running group for a cycle before it recognizes all its participants. Everyone must use version 1.1.0; older versions use a different admission protocol and pattern order.

There is no leader election, shared wall-clock epoch, public-chat traffic, network relay, or dashboard dependency. With timely game updates and an unchanged roster, accounts issue formation steps on corresponding server ticks. Network stalls, suspended tabs, or missing updates can temporarily put an account behind: the protocol detects/reassembles after these conditions rather than guaranteeing exact simultaneous packet arrival over an arbitrary network. Keep clients running normally; the script cannot make a suspended browser execute.

Recognition is based on visible behavior, not a private identity signal: a person deliberately reproducing the entry or dance protocol cannot be distinguished from a script. Ordinary passersby are ignored. After approximately 90 seconds without reaching a held pose, accounts try the next destination instead of waiting forever.

## UI counters

- **Running:** elapsed time since startup, including pauses, banking and travel.
- **Cities visited:** distinct formation cities where this run reached a held pattern; shopping and bank trips do not count.
- **Patterns formed:** completed nine-tick pattern holds, accumulated across destinations and death recovery.

## Destinations

The list follows the local WalkTo catalogue. Centres are fixed in this file and verified against the locally bundled collision map, including all adjacent movement edges and the entry lane. This avoids different clients choosing different squares when doors open or close. The script checks live collision too and skips an obstructed location; it does not invent another centre.

| Order | Destination | Formation centre (x, z) |
|---:|---|---|
| 1 | Lumbridge | 3224, 3223 |
| 2 | Varrock | 3210, 3422 |
| 3 | Falador | 2964, 3377 |
| 4 | Ardougne | 2661, 3301 |
| 5 | Rellekka | 2668, 3660 |
| 6 | Taverley | 2895, 3436 |
| 7 | Draynor | 3101, 3237 |
| 8 | Al Kharid | 3275, 3161 |
| 9 | Edgeville | 3088, 3487 |
| 10 | Seers' Village | 2739, 3501 |
| 11 | Catherby | 2804, 3435 |
| 12 | Yanille | 2604, 3085 |

All centres are on ground level. The script uses rs2b0t's walking/navigation API with teleport use disabled. Routes which repeatedly make no progress are skipped. Map changes can require updating this shared file for everyone.

After death, it waits for the Lumbridge respawn, obtains at least 5 gp from a Man, replaces/equips its skirt as needed, and starts checking destinations from Lumbridge again. Surviving skirts are reused. Automatic login/reconnection remains the client's responsibility.

## Verification

The focused checks cover solo/small/full groups, unrelated local tick origins, random passersby and stationary bystanders, queued and staggered joins, capacity overflow, departure, pause, delayed observations, one-tile movement, startup banking order and retries, and UI counters. Run `bun test test/scripts/pink-skirt-summoning-ritual.test.mjs test/adapter/visible-player-states.test.ts`. The unchanged floor coordinates were previously checked against collision pack SHA-256 `04ef48054324935f7eca00efa76f9744b77d00a5824d43b7544f067ab4d7715a`.

This has **not been tested with live game accounts**. The simulation cannot reproduce every network, client, game-map, or server condition. Use the same script version across participating accounts. The implementation follows the client's local ABI 1 source and [official rs2b0t scripting API](https://github.com/rs2b2t/rs2b0t/blob/main/docs/API.md).

The script reads player positions and visible equipment through the client adapter. No account information, credentials, or private endpoints are embedded.
