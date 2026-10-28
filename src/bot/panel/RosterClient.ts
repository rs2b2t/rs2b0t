import { isRosterScript, type RosterClient } from '../multibox/RosterTypes.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { SettingsStore } from '../runtime/Settings.js';
import type BotPanel from './BotPanel.js';

function requireScript(script: string): void {
    if (!isRosterScript(script)) throw new Error('Choose a script.');
}

export function createRosterClient(panel: BotPanel): RosterClient {
    return {
        scripts: () => ScriptRegistry.list().map(meta => meta.name).filter(isRosterScript),
        selectedScript: () => panel.selectedScriptName(),
        readSettings: script => {
            requireScript(script);
            const meta = ScriptRegistry.get(script);
            if (!meta) throw new Error(`Unknown script: ${script}`);
            return Object.fromEntries(Object.entries(meta.settingsSchema ?? {}).map(([key, def]) =>
                [key, SettingsStore.displayString(script, key, def)]));
        },
        assignScript: script => { requireScript(script); panel.assignScript(script); },
        copySettings: (script, values) => { requireScript(script); panel.copyScriptSettings(script, values); },
        startScript: () => panel.startRosterScript(),
        stopScript: () => panel.stopScript(),
        travelTo: destination => panel.travelTo(destination),
        editSettings: () => panel.editScriptSettings()
    };
}
