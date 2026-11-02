import type { SlotSnapshot } from './types.js';

export class BotTabMenu {
    private menu: HTMLElement | null = null;
    private cleanup: (() => void) | null = null;

    constructor(private move: (id: number, tab: string) => void) {}

    open(slot: Pick<SlotSnapshot, 'id' | 'tab'>, tabs: string[], x: number, y: number, anchor: HTMLElement): void {
        this.close();
        const menu = document.createElement('div');
        menu.className = 'mbx-tabmenu mbx-bot-tabmenu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Send to tab');
        menu.tabIndex = -1;
        const title = document.createElement('div');
        title.className = 'mbx-bot-tabmenu-title';
        title.textContent = 'Send to tab';
        menu.append(title);
        const choices: HTMLButtonElement[] = [];
        for (const tab of tabs) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = tab;
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-label', tab);
            button.setAttribute('aria-checked', String(tab === slot.tab));
            button.disabled = tab === slot.tab;
            button.addEventListener('click', () => {
                this.close();
                this.move(slot.id, tab);
                anchor.focus({ preventScroll: true });
            });
            menu.append(button);
            if (!button.disabled) choices.push(button);
        }
        document.body.append(menu);
        this.menu = menu;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        const away = (event: Event): void => {
            if (!(event.target instanceof Node) || !menu.contains(event.target)) this.close();
        };
        const close = (): void => this.close();
        const keydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
                anchor.focus({ preventScroll: true });
            } else if (event.key === 'Tab') {
                this.close();
            } else if (choices.length && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const current = choices.findIndex(button => button === document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
                    : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
                choices[next].focus();
            }
        };
        document.addEventListener('pointerdown', away);
        document.addEventListener('wheel', away, { passive: true });
        document.addEventListener('keydown', keydown);
        window.addEventListener('blur', close);
        window.addEventListener('resize', close);
        this.cleanup = () => {
            document.removeEventListener('pointerdown', away);
            document.removeEventListener('wheel', away);
            document.removeEventListener('keydown', keydown);
            window.removeEventListener('blur', close);
            window.removeEventListener('resize', close);
        };
        (choices[0] ?? menu).focus({ preventScroll: true });
    }

    close(): void {
        this.cleanup?.();
        this.cleanup = null;
        this.menu?.remove();
        this.menu = null;
    }
}
