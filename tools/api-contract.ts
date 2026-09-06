#!/usr/bin/env bun
// Drift gate: globalThis.__rs2b0t versus packages/rs2b0t-api/index.d.ts over the names index.js re-exports; --check exits 1 on drift.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const ABI_FILE = 'src/bot/runtime/abi.ts';
const DTS_FILE = 'packages/rs2b0t-api/index.d.ts';
const JS_FILE = 'packages/rs2b0t-api/index.js';
const ALLOWLIST_FILE = 'packages/rs2b0t-api/contract-allowlist.json';

export interface Member {
    type: string;
    optional: boolean;
}
/** Member name -> member. null: the export carries no members (a function, an array or a primitive). */
export type Members = Map<string, Member> | null;
export type Surface = Map<string, Members>;

export type DriftKind = 'undeclared-export' | 'phantom-export' | 'missing-at-runtime' | 'undeclared-member' | 'phantom-member';
export interface Drift {
    kind: DriftKind;
    export: string;
    member?: string;
    signature?: string;
}

function hidden(sym: ts.Symbol): boolean {
    const name = sym.getName();
    if (name.startsWith('_') || name.startsWith('#') || name === 'prototype' || name === 'constructor') {
        return true;
    }
    if (sym.getJsDocTags().some(tag => tag.name === 'internal')) {
        return true;
    }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (decl && ts.canHaveModifiers(decl)) {
        const mods = ts.getModifiers(decl) ?? [];
        return mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
    }
    return false;
}

function member(checker: ts.TypeChecker, sym: ts.Symbol, at: ts.Node): Member {
    return {
        type: checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, at), at, ts.TypeFormatFlags.NoTruncation),
        optional: (sym.flags & ts.SymbolFlags.Optional) !== 0
    };
}

function membersOfType(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): Members {
    const out = new Map<string, Member>();
    const ctor = type.getConstructSignatures()[0];
    if (ctor) {
        for (const m of checker.getPropertiesOfType(ctor.getReturnType())) {
            if (!hidden(m)) {
                out.set(m.getName(), member(checker, m, at));
            }
        }
        for (const m of checker.getPropertiesOfType(type)) {
            if (!hidden(m)) {
                out.set(`static ${m.getName()}`, member(checker, m, at));
            }
        }
        return out;
    }
    if (type.getCallSignatures().length > 0 || checker.isArrayLikeType(type)) {
        return null;
    }
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) {
        return null;
    }
    for (const m of props) {
        if (!hidden(m)) {
            out.set(m.getName(), member(checker, m, at));
        }
    }
    return out;
}

function compilerOptions(): ts.CompilerOptions {
    const cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
    return { ...ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options, noEmit: true, skipLibCheck: true };
}

export function runtimeSurface(): Surface {
    const program = ts.createProgram([ABI_FILE], compilerOptions());
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(ABI_FILE);
    if (!source) {
        throw new Error(`${ABI_FILE} did not load`);
    }
    let literal: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'abi' && node.initializer
            && ts.isCallExpression(node.initializer) && node.initializer.arguments[0] && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
            literal = node.initializer.arguments[0];
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (!literal) {
        throw new Error(`${ABI_FILE}: no \`const abi = Object.freeze({...})\` found`);
    }
    const surface: Surface = new Map();
    for (const prop of checker.getPropertiesOfType(checker.getTypeAtLocation(literal))) {
        surface.set(prop.getName(), membersOfType(checker, checker.getTypeOfSymbolAtLocation(prop, literal), literal));
    }
    return surface;
}

export function declaredSurface(): Surface {
    const program = ts.createProgram([DTS_FILE], compilerOptions());
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(DTS_FILE);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) {
        throw new Error(`${DTS_FILE} did not load as a module`);
    }
    const surface: Surface = new Map();
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        if (!(resolved.flags & ts.SymbolFlags.Value)) {
            continue;
        }
        surface.set(sym.getName(), membersOfType(checker, checker.getTypeOfSymbolAtLocation(resolved, source), source));
    }
    return surface;
}

export function packageExports(js = readFileSync(JS_FILE, 'utf8')): string[] {
    const block = /export const \{([\s\S]*?)\} = abi;/.exec(js);
    if (!block) {
        throw new Error(`${JS_FILE}: no \`export const { ... } = abi\` block`);
    }
    return block[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).join(',').split(',').map(s => s.trim()).filter(Boolean);
}

export function compare(runtime: Surface, declared: Surface, exports: readonly string[], allow: ReadonlySet<string> = new Set()): Drift[] {
    const drifts: Drift[] = [];
    const add = (d: Drift): void => {
        const key = d.member ? `${d.export}.${d.member}` : d.export;
        if (!allow.has(key)) {
            drifts.push(d);
        }
    };
    for (const name of exports) {
        const rt = runtime.get(name);
        const dc = declared.get(name);
        if (rt === undefined) {
            add({ kind: 'missing-at-runtime', export: name });
            continue;
        }
        if (dc === undefined) {
            add({ kind: 'undeclared-export', export: name });
            continue;
        }
        if (!rt || !dc) {
            continue;
        }
        for (const [name_, m] of rt) {
            if (!dc.has(name_)) {
                add({ kind: 'undeclared-member', export: name, member: name_, signature: m.type });
            }
        }
        for (const [name_, m] of dc) {
            if (!rt.has(name_) && !m.optional) {
                add({ kind: 'phantom-member', export: name, member: name_ });
            }
        }
    }
    const exported = new Set(exports);
    for (const name of declared.keys()) {
        if (!exported.has(name)) {
            add({ kind: 'phantom-export', export: name });
        }
    }
    return drifts;
}

export function allowlist(): Set<string> {
    try {
        return new Set(Object.keys(JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')) as Record<string, string>));
    } catch {
        return new Set();
    }
}

export function report(drifts: readonly Drift[]): string {
    if (drifts.length === 0) {
        return 'api-contract: index.d.ts matches the runtime ABI over every index.js export';
    }
    const lines = [`api-contract: ${drifts.length} drift(s)`];
    for (const d of drifts) {
        const where = d.member ? `${d.export}.${d.member}` : d.export;
        lines.push(`  ${d.kind.padEnd(19)} ${where}${d.signature ? `: ${d.signature}` : ''}`);
    }
    return lines.join('\n');
}

if (import.meta.main) {
    const drifts = compare(runtimeSurface(), declaredSurface(), packageExports(), allowlist());
    console.log(report(drifts));
    if (process.argv.includes('--check') && drifts.length > 0) {
        process.exit(1);
    }
}
