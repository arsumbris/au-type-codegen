// Meta-block emission: a type-def's `meta:` block surfaced as generated TS.
//
// Value mode (built here): each owned host def carrying an opted-in meta block
// emits one `export const` of the block's field VALUES, `as const`, optionally
// `satisfies Omit<MetaInterface, 'type'>`. Type mode (a resolved-def-ref union +
// payload map) is a later pass over the same allowlist.
//
// Opt-in per meta-type, keyed on the block's bare `type_name`. Owned defs only
// (a borrowed copy drops its meta on the wire). See
// [[spec - meta-block constant emission - a type-def meta block surfaces as a generated constant keyed by its host def]].

import { CodegenError } from '../../errors.ts'
import type { MetaBlockModel, TypeGraphIR, TypeModel } from '../../ir/ir.ts'
import type { WireShape } from '../../input/wire.ts'
import { parseQualified, screamingSnake, toTsTypeName, tsPropName } from './names.ts'

/** How an opted-in meta type is emitted. `type` mode is a later pass. */
export interface MetaEmitSpec {
  mode: 'const' | 'type'
  /** Overrides the derived name suffix (`intent-routing-meta=ROUTING` → `..._ROUTING`). */
  suffix?: string
}

export interface MetaConstResult {
  /** One `export const ...` block per emitted constant, in emission order. */
  blocks: string[]
  /**
   * Meta-type canonicals named by identifier in a `satisfies` clause, canonical →
   * TS symbols. Merged into the borrow-import resolution, so a cross-repo meta
   * interface imports like any other identifier. Empty when `satisfies` is off.
   */
  identifierRefs: Map<string, Set<string>>
  /** Advisory warnings (an allowlist entry that matched no owned block). */
  warnings: string[]
}

/** The meta-type stem for name derivation: drop a trailing `-meta`. */
const metaStem = (bareMetaType: string): string => bareMetaType.replace(/-meta$/, '')

/** A JSON value (the raw meta field value) to a TS literal expression, `as const`-friendly. */
function renderValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(renderValue).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${tsPropName(k)}: ${renderValue(v)}`,
    )
    return `{ ${entries.join(', ')} }`
  }
  // `undefined` never reaches here — an absent optional field is absent in `body`.
  throw new CodegenError(`meta value of unsupported type: ${typeof value}`)
}

/** The block's fields as a TS object literal, `{ kind: 'broadcast' }`. */
function renderBlock(block: MetaBlockModel): string {
  if (block.fields.length === 0) return '{}'
  const entries = block.fields.map((f) => `${tsPropName(f.name)}: ${renderValue(f.value)}`)
  return `{ ${entries.join(', ')} }`
}

/**
 * Emit the value-mode constants over the owned defs. Throws on a name collision
 * (two constants folding to one identifier), mirroring `buildNameMap`.
 */
export function emitMetaConstants(
  owned: TypeModel[],
  metaConfig: Map<string, MetaEmitSpec>,
  nameOf: (canonical: string) => string,
  satisfies: boolean,
): MetaConstResult {
  const blocks: string[] = []
  const identifierRefs = new Map<string, Set<string>>()
  const warnings: string[] = []
  const matched = new Set<string>() // bare meta-type names that emitted at least one const
  const byConstName = new Map<string, string>() // const name → the `host + metaType` that owns it

  for (const type of owned) {
    for (const block of type.meta) {
      const bareMeta = parseQualified(block.typeName).bare
      const spec = metaConfig.get(bareMeta)
      if (spec === undefined || spec.mode !== 'const') continue
      matched.add(bareMeta)

      const hostBare = parseQualified(type.name).bare
      const constName = `${screamingSnake(hostBare)}_${spec.suffix ?? screamingSnake(metaStem(bareMeta))}`
      const origin = `${type.name} + ${bareMeta}`
      const prior = byConstName.get(constName)
      if (prior !== undefined && prior !== origin) {
        throw new CodegenError(`meta constants '${prior}' and '${origin}' both map to '${constName}'`)
      }
      byConstName.set(constName, origin)

      let line = `export const ${constName} = ${renderBlock(block)} as const`
      if (satisfies) {
        // Name the meta interface via its (possibly `::repo`-qualified) canonical, so a
        // cross-repo meta type drives an import; `Omit<_, 'type'>` strips the discriminant
        // the const must not carry (it is spread onto the host's own `type`).
        const sym = nameOf(block.typeName)
        line += ` satisfies Omit<${sym}, 'type'>`
        const set = identifierRefs.get(block.typeName) ?? new Set<string>()
        set.add(sym)
        identifierRefs.set(block.typeName, set)
      }
      blocks.push(line)
    }
  }

  for (const [metaType, spec] of metaConfig) {
    if (spec.mode === 'const' && !matched.has(metaType)) {
      warnings.push(`--meta '${metaType}=const' matched no owned type-def carrying that meta block`)
    }
  }

  return { blocks, identifierRefs, warnings }
}

export interface MetaTypeResult {
  blocks: string[]
  warnings: string[]
}

/** The single named `def-reference` ceiling inside a shape, or `null` (none, unbound, or compound). */
function defRefBoundOf(shape: WireShape | null): string | null {
  if (shape === null) return null
  switch (shape.kind) {
    case 'def-reference':
      return shape.bound !== undefined && shape.bound.kind === 'single' ? shape.bound.name : null
    case 'list':
    case 'pinned':
      return defRefBoundOf(shape.inner)
    default:
      return null
  }
}

/** Whether `ancestor` (bare) is in `start`'s transitive parent closure. */
function closureIncludes(ir: TypeGraphIR, start: string, ancestor: string): boolean {
  const seen = new Set<string>()
  const stack = [...(ir.byName.get(start)?.parents ?? [])]
  while (stack.length > 0) {
    const bare = parseQualified(stack.pop() as string).bare
    if (bare === ancestor) return true
    if (seen.has(bare)) continue
    seen.add(bare)
    const def = ir.byName.get(bare)
    if (def) stack.push(...def.parents)
  }
  return false
}

/**
 * A concrete leaf carries a literal `type` discriminant, so it is a payload-map
 * member and a union candidate. Mirrors the emitter's `discriminant` literal case:
 * not sealed, has parents, not itself extended. See [[spec - typescript codegen ...]].
 */
function isConcreteLeaf(type: TypeModel): boolean {
  return type.sealed === null && type.parents.length > 0 && !type.extended
}

/** The bare type-def name a def-ref wikilink value targets: strip `[[ ]]`, fragments, `::repo`, path/stem. */
function wikilinkTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  const m = s.match(/^\[\[(.+)\]\]$/)
  if (m) s = m[1]
  s = s.split('|')[0].split('#')[0].split('^')[0].split('::')[0].trim()
  if (s.includes('/')) s = s.slice(s.lastIndexOf('/') + 1)
  s = s.replace(/\.type\.ya?ml$/, '').replace(/\.md$/, '')
  return s.length > 0 ? s : null
}

/** All def-ref targets a meta field value carries (a single wikilink or a list of them). */
function targetsOf(value: unknown): string[] {
  const one = wikilinkTarget(value)
  if (one !== null) return [one]
  if (Array.isArray(value)) return value.map(wikilinkTarget).filter((n): n is string => n !== null)
  return []
}

/**
 * Type-mode emission: resolve a def-ref-list meta into compile-time types.
 * - a per-host union of the resolved def-ref `type` literals, keyed by host def.
 * - a subtype-family payload map, keyed by each leaf's `type` literal, emitted
 *   where the def-ref bound's family is OWNED (per-package).
 * The consumer owns the `Handlers` mapped type; codegen owns these facts. See
 * [[spec - meta-block constant emission - a type-def meta block surfaces as a generated constant keyed by its host def]].
 */
export function emitMetaTypes(
  ir: TypeGraphIR,
  owned: TypeModel[],
  metaConfig: Map<string, MetaEmitSpec>,
  nameOf: (canonical: string) => string,
): MetaTypeResult {
  const blocks: string[] = []
  const warnings: string[] = []
  const producedFor = new Set<string>() // meta types that emitted a union or a map
  const byTypeName = new Map<string, string>() // emitted type name → its origin, for the collision guard

  const claim = (name: string, origin: string): void => {
    const prior = byTypeName.get(name)
    if (prior !== undefined && prior !== origin) {
      throw new CodegenError(`meta types '${prior}' and '${origin}' both map to '${name}'`)
    }
    byTypeName.set(name, origin)
  }

  // (a) per-host union of resolved handled-intent `type` literals.
  for (const type of owned) {
    for (const block of type.meta) {
      const bareMeta = parseQualified(block.typeName).bare
      const spec = metaConfig.get(bareMeta)
      if (spec === undefined || spec.mode !== 'type') continue

      // The def-ref fields of the meta type (fall back to every wikilink field if its def is absent).
      const metaDef = ir.byName.get(bareMeta)
      const defRefFields = metaDef
        ? new Set(metaDef.fields.filter((f) => defRefBoundOf(f.shape) !== null).map((f) => f.name))
        : null

      const names: string[] = []
      for (const field of block.fields) {
        if (defRefFields !== null && !defRefFields.has(field.name)) continue
        names.push(...targetsOf(field.value))
      }
      const unique = [...new Set(names)]

      const hostBare = parseQualified(type.name).bare
      const unionName = `${toTsTypeName(hostBare)}${spec.suffix ?? toTsTypeName(metaStem(bareMeta))}`
      claim(unionName, `${type.name} + ${bareMeta}`)
      const rhs = unique.length > 0 ? unique.map((n) => `'${n}'`).join(' | ') : 'never'
      blocks.push(`export type ${unionName} = ${rhs}`)
      producedFor.add(bareMeta)
    }
  }

  // (b) subtype-family payload map, one per bound base, where the family is owned here.
  const emittedBases = new Set<string>()
  for (const [metaType, spec] of metaConfig) {
    if (spec.mode !== 'type') continue
    const metaDef = ir.byName.get(metaType)
    if (metaDef === undefined) continue
    const bound = metaDef.fields.map((f) => defRefBoundOf(f.shape)).find((b) => b !== null)
    if (bound === undefined || bound === null || emittedBases.has(bound)) continue
    const members = owned.filter((t) => isConcreteLeaf(t) && closureIncludes(ir, t.name, bound))
    if (members.length === 0) continue // the family is not owned in this read
    emittedBases.add(bound)

    const mapName = `${toTsTypeName(bound)}Payloads`
    claim(mapName, `payload map for ${bound}`)
    const entries = members.map((t) => `  ${tsPropName(t.name)}: ${nameOf(t.name)}`).join('\n')
    blocks.push(`export interface ${mapName} {\n${entries}\n}`)
    producedFor.add(metaType)
  }

  for (const [metaType, spec] of metaConfig) {
    if (spec.mode === 'type' && !producedFor.has(metaType)) {
      warnings.push(`--meta '${metaType}=type' produced nothing: no owned host carries it, and its def-ref-bound family is not owned here`)
    }
  }

  return { blocks, warnings }
}
