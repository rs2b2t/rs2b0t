import IfType, { type ComponentType } from '#/client/config/IfType.js';

export function component(id: number, type: ComponentType): IfType {
    const result = new IfType();
    result.id = id;
    result.type = type;
    return result;
}

export function installComponents(components: readonly IfType[]): void {
    IfType.list = [];
    for (const component of components) {
        IfType.list[component.id] = component;
    }
}
