import { TaskBot } from './Bot.js';

export abstract class AgilityCourseBot extends TaskBot {
    protected course: string[] = [];
    protected laps = 0;
    private step = 0;

    protected abstract logResync(change: string): void;

    currentName(): string {
        return this.course[this.step];
    }

    courseNames(): string[] {
        return this.course;
    }

    advance(): void {
        this.step++;
        if (this.step >= this.course.length) {
            this.step = 0;
            this.laps++;
            this.log(`lap ${this.laps} complete`);
        }
    }

    resyncTo(name: string): boolean {
        const idx = this.course.indexOf(name);
        if (idx === -1) {
            return false;
        }
        this.logResync(`step ${this.step} (${this.currentName()}) -> ${idx} (${name})`);
        this.step = idx;
        return true;
    }
}
