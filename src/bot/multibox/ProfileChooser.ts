import { vault, type Profile } from './ProfileVault.js';
import { resolveWorldNumber, type WorldNumber } from '../../client/config/worlds.js';
import { supportsWorldRouting } from '../../client/config/target.js';

export interface ProfileChooserOptions {
    worldRouting?: boolean;
    defaultWorld?: WorldNumber;
    onWorldChange?: (profile: Profile, world: WorldNumber) => Promise<boolean>;
}

export class ProfileChooser {
    readonly el: HTMLDivElement;

    private list: HTMLDivElement;
    private user: HTMLInputElement;
    private pass: HTMLInputElement;
    private world: HTMLSelectElement;
    private status: HTMLDivElement;
    private defaultWorld: WorldNumber;
    private worldRouting: boolean;
    private pending = false;

    constructor(private onLoad: (p: Profile) => void, private options: ProfileChooserOptions = {}) {
        this.worldRouting = options.worldRouting ?? supportsWorldRouting();
        this.defaultWorld = options.defaultWorld ?? (this.worldRouting ? resolveWorldNumber(location.host, new URLSearchParams(location.search)) : 1);
        if (this.defaultWorld !== 1 && this.defaultWorld !== 2) throw new Error('profile world must be 1 or 2');
        this.el = document.createElement('div');
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.close();
            }
        });
        this.el.addEventListener('keydown', ev => {
            if (ev.key !== 'Escape' || this.el.hidden || !this.el.isConnected) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            this.close();
        });

        const box = document.createElement('div');
        box.className = 'mbx-chooser';

        const title = document.createElement('div');
        title.className = 'mbx-chooser-title';
        title.textContent = 'saved profiles';

        this.list = document.createElement('div');
        this.list.className = 'mbx-chooser-list';

        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        this.user = document.createElement('input');
        this.user.id = 'mbx-new-user';
        this.user.placeholder = 'username';
        this.pass = document.createElement('input');
        this.pass.id = 'mbx-new-pass';
        this.pass.type = 'password';
        this.pass.placeholder = 'password';
        this.world = this.worldSelect(this.defaultWorld, 'World for new profile');
        this.world.id = 'mbx-new-world';
        const go = document.createElement('button');
        go.id = 'mbx-new-go';
        go.type = 'submit';
        go.textContent = 'create + load';
        form.append(this.user, this.pass);
        if (this.worldRouting) form.append(this.world);
        form.append(go);
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            void this.create();
        });

        this.status = document.createElement('div');
        this.status.className = 'mbx-chooser-status';
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        box.append(title, this.list, this.status, form);
        this.el.appendChild(box);
    }

    open(): void {
        this.render();
        this.el.hidden = false;
        this.user.focus();
    }

    close(): void {
        this.el.hidden = true;
    }

    private worldSelect(world: WorldNumber, label: string): HTMLSelectElement {
        const select = document.createElement('select');
        select.setAttribute('aria-label', label);
        for (const number of [1, 2]) {
            const option = document.createElement('option');
            option.value = String(number);
            option.textContent = `World ${number}`;
            select.appendChild(option);
        }
        select.value = String(world);
        return select;
    }

    private selectedWorld(select: HTMLSelectElement): WorldNumber {
        if (select.value !== '1' && select.value !== '2') throw new Error('profile world must be 1 or 2');
        return Number(select.value) as WorldNumber;
    }

    private withWorld(profile: Profile): Profile {
        return this.worldRouting ? { ...profile, world: profile.world ?? this.defaultWorld } : { ...profile };
    }

    private setPending(pending: boolean): void {
        this.pending = pending;
        this.el.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(control => {
            control.disabled = pending || (control.classList.contains('mbx-profile-world') && !this.options.onWorldChange);
        });
    }

    private async create(): Promise<void> {
        const username = this.user.value.trim();
        if (this.pending || username.length === 0) return;
        this.setPending(true);
        this.status.textContent = 'Saving profile...';
        try {
            const existed = vault.list().some(p => p.username === username);
            await vault.upsert({ username, password: this.pass.value, ...(this.worldRouting ? { world: this.selectedWorld(this.world) } : {}) });
            const saved = vault.list().find(p => p.username === username);
            if (!saved) throw new Error('The saved profile is no longer available');
            if (!existed) delete saved.tab;
            this.user.value = '';
            this.pass.value = '';
            this.status.textContent = '';
            this.close();
            this.onLoad(this.withWorld(saved));
        } catch (error) {
            this.status.textContent = error instanceof Error ? error.message : 'Could not save the profile';
        } finally {
            this.setPending(false);
            this.render();
        }
    }

    private async changeWorld(profile: Profile, select: HTMLSelectElement): Promise<void> {
        if (!this.worldRouting || this.pending || !this.options.onWorldChange) return;
        this.setPending(true);
        this.status.textContent = `Switching ${profile.username}...`;
        try {
            const changed = await this.options.onWorldChange(profile, this.selectedWorld(select));
            this.status.textContent = changed ? '' : 'Log out in-game, then choose the world again';
        } catch (error) {
            this.status.textContent = error instanceof Error ? error.message : 'Could not change the profile world';
        } finally {
            this.setPending(false);
            this.render();
        }
    }

    private render(): void {
        this.list.textContent = '';
        const profiles = vault.list();
        if (profiles.length === 0) {
            const none = document.createElement('div');
            none.className = 'mbx-chooser-empty';
            none.textContent = 'no saved profiles yet';
            this.list.appendChild(none);
            return;
        }
        for (const p of profiles) {
            const row = document.createElement('div');
            row.className = 'mbx-profile-row';
            const name = document.createElement('span');
            name.className = 'mbx-profile-name';
            name.textContent = p.username;
            const world = this.worldSelect(p.world ?? this.defaultWorld, `World for ${p.username}`);
            world.className = 'mbx-profile-world';
            world.disabled = this.pending || !this.options.onWorldChange;
            world.addEventListener('click', ev => ev.stopPropagation());
            world.addEventListener('change', () => { void this.changeWorld(p, world); });
            const del = document.createElement('button');
            del.className = 'mbx-profile-del';
            del.type = 'button';
            del.textContent = '✕';
            del.addEventListener('click', ev => {
                ev.stopPropagation();
                if (this.pending) return;
                void vault.remove(p.username);
                this.render();
            });
            del.disabled = this.pending;
            row.append(name);
            if (this.worldRouting) row.append(world);
            row.append(del);
            row.addEventListener('click', () => {
                if (this.pending) return;
                this.close();
                this.onLoad(this.withWorld(p));
            });
            this.list.appendChild(row);
        }
        const all = document.createElement('button');
        all.id = 'mbx-load-all';
        all.type = 'button';
        all.disabled = this.pending;
        all.textContent = 'load all profiles';
        all.addEventListener('click', () => {
            if (this.pending) return;
            this.close();
            for (const p of vault.list()) {
                this.onLoad(this.withWorld(p));
            }
        });
        this.list.appendChild(all);
    }
}
