// Name mapping for the TypeScript target.
//
// Canonical dotted type-def names become PascalCase identifiers. Casing and
// identifier-collision rules are language-specific, so this lives in the
// emitter, not the IR.

import { CodegenError } from '../../errors.ts'
import type { TypeGraphIR } from '../../ir/ir.ts'

const TS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const pascal = (s: string): string => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1))

/**
 * Split a canonical name on the `::repo` owner qualifier.
 * `widget::xr-base` → `{ bare: 'widget', owner: 'xr-base' }`, a bare name → `{ bare, owner: null }`.
 * The engine serves a cross-repo reference name-qualified (`name::repo`); the owner
 * rides in the name, since the referenced def itself is not materialized in a
 * consumer's scoped read. See [[type repo qualifier::au-engine]].
 */
export function parseQualified(canonical: string): { bare: string; owner: string | null } {
  const idx = canonical.indexOf('::')
  if (idx < 0) return { bare: canonical, owner: null }
  return { bare: canonical.slice(0, idx), owner: canonical.slice(idx + 2) }
}

/**
 * PascalCase a bare (unqualified) name across its `.`, `-`, `_` boundaries.
 * `decided_by` becomes `DecidedBy`, `bento-node.leaf` becomes `BentoNodeLeaf`.
 * The identifier-forming half of `toTsTypeName`, reused for a field-name segment
 * (an enum-value const derives `<HostType><Field>Values`).
 */
export function pascalName(name: string): string {
  return name
    .split(/[.\-_]/)
    .filter((segment) => segment.length > 0)
    .map(pascal)
    .join('')
}

/**
 * A canonical type-def name to its PascalCase TS identifier.
 * Dotted segments and `-`/`_` separators are PascalCased and concatenated.
 * `decision.decided` becomes `DecisionDecided`, `bento-node.leaf` becomes `BentoNodeLeaf`.
 * A `::repo` qualifier is stripped first: `widget::xr-base` becomes `Widget`, the
 * bare identifier of the imported cross-repo type.
 */
export function toTsTypeName(canonical: string): string {
  return pascalName(parseQualified(canonical).bare)
}

/** Build the canonical to TS-name map, throwing when two names collide in TS. */
export function buildNameMap(ir: TypeGraphIR): Map<string, string> {
  const map = new Map<string, string>()
  const seen = new Map<string, string>() // tsName -> canonical
  for (const type of ir.types) {
    const ts = toTsTypeName(type.name)
    const prior = seen.get(ts)
    if (prior !== undefined && prior !== type.name) {
      throw new CodegenError(`type names '${prior}' and '${type.name}' both map to TS identifier '${ts}'`)
    }
    seen.set(ts, type.name)
    map.set(type.name, ts)
  }
  return map
}

/** A property name, quoted only when it is not a bare TS identifier. */
export function tsPropName(name: string): string {
  return TS_IDENT.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`
}

/**
 * SCREAMING_SNAKE_CASE of a canonical name: every `.`, `-`, `_` boundary becomes
 * `_`, then uppercased. `bento-node.leaf` → `BENTO_NODE_LEAF`. Used for meta-block
 * constant names. Lossy across those separators (so `bento-node` and `bento.node`
 * collide), guarded by a collision pass, see the meta emitter.
 */
export function screamingSnake(name: string): string {
  return name
    .split(/[.\-_]/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toUpperCase())
    .join('_')
}
