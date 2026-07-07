import { Game } from '../api/Game.js';
import { BotHost } from '../BotHost.js';

/**
 * Ambient social layer: every so often the bot says something human — the
 * difference between "an account grinding a spot" and "a person who's also
 * chatting while they play". Sparse and randomized (real players talk in
 * bursts, not on a metronome), so a cluster of bots at one spot reads like
 * people hanging out rather than a synchronized fleet. Enabled globally in
 * main.ts (disable with bot.html?chat=0).
 *
 * v1 is one-way ambient chatter; reacting to nearby players' messages (real
 * back-and-forth) is a follow-up that reads the chat feed.
 */
const PHRASES = [
    'lol', 'nice', 'gz', 'thx', 'lmao', 'haha', 'brb', 'wb', 'ty', 'np', 'gl', 'same', 'yeah', 'ikr', 'wow',
    'anyone wanna trade?', 'any1 got a spare axe', 'training str atm', 'wc here?', 'how much for that',
    'where do i sell this', 'any1 know the way to varrock', 'is this draynor?', 'need a friend for a quest',
    'anyone doing cooks assistant?', 'buying lobbies', 'selling iron ore', 'whats ur cb lvl', 'im 20 str',
    'lvl 15 here', 'wanna duel?', 'this place is packed', 'so many ppl here', 'anyone f2p?',
    'best place to train?', 'how do i get to fally', 'nice hat', 'where u from', 'good xp here',
    'almost 30 str', 'grinding str', 'love this game', 'any tips?', 'lag anyone?', 'brb food'
];

// ~600ms per game tick. Gaps between messages, and a grace period after login.
const MIN_GAP_TICKS = 400; // ~4 min
const MAX_GAP_TICKS = 900; // ~9 min
const START_GRACE_TICKS = 100; // ~1 min settled in before the first line
const QUIET_CHANCE = 0.4; // sometimes the scheduled slot passes in silence

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

class ChatterImpl {
    private enabled = false;
    private nextAt = -1;

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;
        BotHost.addFrameListener(() => this.tick());
    }

    private schedule(now: number, first = false): void {
        const floor = first ? START_GRACE_TICKS : MIN_GAP_TICKS;
        this.nextAt = now + floor + Math.floor(Math.random() * (MAX_GAP_TICKS - MIN_GAP_TICKS));
    }

    private tick(): void {
        if (!Game.ingame()) {
            this.nextAt = -1; // reset the schedule across a logout/relogin
            return;
        }

        const now = Game.tick();
        if (this.nextAt < 0) {
            this.schedule(now, true);
            return;
        }
        if (now < this.nextAt) {
            return;
        }

        // humans don't fill every silence
        if (Math.random() >= QUIET_CHANCE) {
            this.speak();
        }
        this.schedule(now);
    }

    /**
     * Ask the host's LLM "brain" for an in-character reply if one is wired in.
     * The farm exposes globalThis.__lcbuddyBrain, which calls the model with the
     * API key SERVER-SIDE (in the farm process) — the key is never in this public
     * browser bundle. It's handed the bot's name and recent nearby chat, so a
     * cluster of bots holds a real back-and-forth. Falls back to a static phrase
     * when no brain is present or the call fails.
     */
    private speak(): void {
        const brain = (globalThis as Record<string, unknown>).__lcbuddyBrain;
        if (typeof brain !== 'function') {
            Game.say(pick(PHRASES));
            return;
        }
        const ctx = { name: Game.myName() ?? 'someone', recent: Game.recentChat(8) };
        Promise.resolve((brain as (c: unknown) => Promise<string>)(ctx))
            .then(reply => {
                const line = String(reply ?? '').trim().slice(0, 80);
                if (line && Game.ingame()) {
                    Game.say(line);
                }
            })
            .catch(() => Game.say(pick(PHRASES)));
    }
}

export const Chatter = new ChatterImpl();
