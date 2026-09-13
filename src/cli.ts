#!/usr/bin/env -S node --experimental-transform-types
// au-type-codegen CLI: read a type graph, emit a TypeScript module.
//
// Run under `--experimental-transform-types`: au-engine-sdk's source uses
// constructor parameter properties, which Node's default type-stripping
// rejects. The transform handles them.
//
// Sources:
//   --entry <path>        attach to the running daemon for this entry and read its
//                         type graph (attaches only — never spawns an engine). The
//                         path is the folder-repo entry DIRECTORY the daemon homes
//                         on (a directory carrying `.arsumbris/repo.yaml`); the SDK
//                         resolves the hashed socket from it. Both must point at
//                         the same entry.
//   --repo <name>         scope the read to one workspace member (its declared
//                         name); required for per-package generation, since the
//                         unscoped read is NOT the union over members
//   --types-json <file>   read a WireTypeDef[] JSON dump (offline, no daemon)
// Target:
//   --target ts            TypeScript module (default)
//   --target json-schema   JSON Schema (Draft 2020-12); --type for one, else a map of all
//   --type <name>          for json-schema, the single type-def to emit
// Borrows (ts target, per-package):
//   A cross-repo dependency surfaces as a `::repo`-qualified reference in an owned
//   def; its owner is mapped to an importable module. An unmapped owner is an error.
//   --module-map <file>    JSON `{ "<owner-repo>": "<module-specifier>" }`, resolves where
//                          a borrowed type is imported from, e.g. `host → @arsumbris/au-host-sdk`
//   --module <o>=<spec>    one owner→module entry inline; repeatable; overlays --module-map
// Meta-block emission (ts target):
//   --meta <type>=<mode>[:<suffix>]
//                          opt a meta type into emission. `const` emits a per-host
//                          constant from the block's values (`--meta intent-routing-meta=const:ROUTING`
//                          → `OPEN_INTENT_ROUTING = { ... } as const`). `type` (Phase 4)
//                          resolves a def-ref-list meta to types. Repeatable.
//   --meta-satisfies       a const appends `satisfies Omit<MetaInterface, 'type'>`
// Enum value arrays (ts target):
//   --enum-field-values    a top-level FIELD enum also emits a runtime value array
//                          (`LayerPrimitiveKindValues = ['box', …] as const`). A NAMED
//                          enum brand (`KeyName` → `KeyNameValues`) always emits one.
// Output:
//   --out <file>          write the result (default: stdout)

import { readFileSync, writeFileSync } from 'node:fs'
import { emitJsonSchema } from './emit/json-schema/emit.ts'
import type { MetaEmitSpec } from './emit/ts/meta.ts'
import { generate } from './generate.ts'
import { readTypesFromDaemon } from './input/daemon.ts'
import { buildIR } from './ir/build.ts'
import type { WireTypeDef } from './input/wire.ts'

type Target = 'ts' | 'json-schema'

interface Args {
  entry?: string
  repo?: string
  typesJson?: string
  out?: string
  target: Target
  type?: string
  moduleMapFile?: string
  /** Inline `owner=specifier` entries, in order; overlay the file. */
  moduleEntries: string[]
  /** `<metaType>=<mode>[:<suffix>]` entries, in order. */
  metaEntries: string[]
  metaSatisfies: boolean
  enumFieldValues: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: 'ts', moduleEntries: [], metaEntries: [], metaSatisfies: false, enumFieldValues: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--entry':
        args.entry = value
        i++
        break
      case '--repo':
        args.repo = value
        i++
        break
      case '--types-json':
        args.typesJson = value
        i++
        break
      case '--out':
        args.out = value
        i++
        break
      case '--target':
        if (value !== 'ts' && value !== 'json-schema') throw new Error(`--target must be 'ts' or 'json-schema', got '${value}'`)
        args.target = value
        i++
        break
      case '--type':
        args.type = value
        i++
        break
      case '--module-map':
        args.moduleMapFile = value
        i++
        break
      case '--module':
        args.moduleEntries.push(value)
        i++
        break
      case '--meta':
        args.metaEntries.push(value)
        i++
        break
      case '--meta-satisfies':
        args.metaSatisfies = true
        break
      case '--enum-field-values':
        args.enumFieldValues = true
        break
      default:
        throw new Error(`unknown argument '${flag}'`)
    }
  }
  return args
}

/** Build the owner→module map: the JSON file first, then inline `--module owner=spec` overlays. */
function buildModuleMap(args: Args): Map<string, string> {
  const map = new Map<string, string>()
  if (args.moduleMapFile !== undefined) {
    const parsed = JSON.parse(readFileSync(args.moduleMapFile, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`--module-map must be a JSON object of owner → module-specifier, got ${args.moduleMapFile}`)
    }
    for (const [owner, spec] of Object.entries(parsed)) {
      if (typeof spec !== 'string') throw new Error(`--module-map entry '${owner}' must map to a string module specifier`)
      map.set(owner, spec)
    }
  }
  for (const entry of args.moduleEntries) {
    const eq = entry.indexOf('=')
    if (eq <= 0) throw new Error(`--module must be 'owner=specifier', got '${entry}'`)
    map.set(entry.slice(0, eq), entry.slice(eq + 1))
  }
  return map
}

/** Build the meta allowlist from `--meta <type>=<mode>[:<suffix>]` entries. */
function buildMetaConfig(args: Args): Map<string, MetaEmitSpec> {
  const map = new Map<string, MetaEmitSpec>()
  for (const entry of args.metaEntries) {
    const eq = entry.indexOf('=')
    if (eq <= 0) throw new Error(`--meta must be '<type>=<mode>[:<suffix>]', got '${entry}'`)
    const metaType = entry.slice(0, eq)
    const rest = entry.slice(eq + 1)
    const colon = rest.indexOf(':')
    const mode = colon < 0 ? rest : rest.slice(0, colon)
    const suffix = colon < 0 ? undefined : rest.slice(colon + 1)
    if (mode !== 'const' && mode !== 'type') throw new Error(`--meta mode must be 'const' or 'type', got '${mode}' in '${entry}'`)
    map.set(metaType, { mode, suffix })
  }
  return map
}

function render(defs: WireTypeDef[], args: Args): string {
  if (args.target === 'ts') {
    return generate(defs, {
      repo: args.repo,
      moduleMap: buildModuleMap(args),
      meta: buildMetaConfig(args),
      metaSatisfies: args.metaSatisfies,
      enumFieldValues: args.enumFieldValues,
      onWarn: (message) => process.stderr.write(`warning: ${message}\n`),
    })
  }
  const ir = buildIR(defs)
  // json-schema: one document for --type, else a map of every type to its schema.
  if (args.type !== undefined) return `${JSON.stringify(emitJsonSchema(ir, args.type), null, 2)}\n`
  const all: Record<string, unknown> = {}
  for (const t of ir.types) all[t.name] = emitJsonSchema(ir, t.name)
  return `${JSON.stringify(all, null, 2)}\n`
}

async function loadTypes(args: Args): Promise<WireTypeDef[]> {
  if (args.entry !== undefined) return readTypesFromDaemon(args.entry, args.repo)
  if (args.typesJson !== undefined) return JSON.parse(readFileSync(args.typesJson, 'utf8')) as WireTypeDef[]
  throw new Error('provide --entry <path> (live daemon) or --types-json <file> (offline)')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const output = render(await loadTypes(args), args)
  if (args.out !== undefined) {
    writeFileSync(args.out, output)
    process.stderr.write(`wrote ${args.out}\n`)
  } else {
    process.stdout.write(output)
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
