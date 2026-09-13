// Map a parsed WireShape to a TypeScript type expression, authored face.
//
// Authored face: a reference is a branded wikilink (`Ref<'name'>`), an
// inline-or-reference is `Name | Ref<'name'>`. The resolved face (references
// as their target type) is a later variant, see the spec's Future.
//
// Relies on TS operator precedence: `&` binds tighter than `|`, so unions of
// intersections need no parens. Parens are added only where grouping flips it.

import { assertNeverShape } from '../../errors.ts'
import type { WireRefinement, WireShape } from '../../input/wire.ts'
import { parseQualified } from './names.ts'

const PRIMITIVE_TS: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'string',
  DateTime: 'string',
  Url: 'string',
}

const quoted = (name: string): string => `'${name}'`

/**
 * A type-def name as a `Ref`/`DefRef` brand string literal: the `::repo`
 * qualifier is stripped first, the same normalization the identifier path
 * applies via `toTsTypeName`. Within a generated module the bare name is already
 * unique (a same-named collision is caught upstream by `buildNameMap`), so the
 * qualifier carries no identity the module doesn't already guarantee; stripping
 * keeps the brand consistent with its sibling identifier. Enum members are NOT
 * type names and stay on `quoted`. Requested by au-host, see
 * [[message - 260708000013 - ref and def-ref brand literals keep the repo qualifier::au-host]].
 */
const brand = (name: string): string => quoted(parseQualified(name).bare)

/**
 * Whether a shape renders to a single TS atom safe before a `[]` suffix — a
 * primitive, a `Ref<…>`, a record identifier, or a list (itself `…[]`). A
 * union/intersection/enum/inline-or-reference is NOT atomic, so a list over it
 * uses `Array<…>` to avoid `A | B[]` binding the `[]` to `B` alone.
 */
function isSimpleElement(shape: WireShape): boolean {
  switch (shape.kind) {
    case 'primitive':
    case 'reference':
    case 'record':
    case 'list':
    // `any`/`opaque` → `unknown`, `def-reference` → `DefRef<…>`: each a single atom, safe before `[]`.
    case 'any':
    case 'opaque':
    case 'def-reference':
    // `refined` renders to its base primitive TS type, a single atom.
    case 'refined':
    // `tuple` renders to a bracketed `[…]` literal, a single atom safe before `[]` (an array of tuples).
    case 'tuple':
      return true
    case 'enum':
    case 'union':
    case 'intersection':
    case 'inline-or-reference':
    case 'compound-reference':
      return false
    // `pinned` renders as its inner shape's type, so it is simple iff the inner is.
    case 'pinned':
      return isSimpleElement(shape.inner)
    default:
      return assertNeverShape(shape)
  }
}

/** A WireShape to its TypeScript type expression. `nameOf` maps a canonical type name to its TS identifier. */
export function shapeToTs(shape: WireShape, nameOf: (canonical: string) => string): string {
  switch (shape.kind) {
    case 'primitive':
      return PRIMITIVE_TS[shape.name]
    case 'enum':
      return shape.members.map(quoted).join(' | ')
    case 'reference':
      return `Ref<${brand(shape.name)}>`
    case 'record':
      return nameOf(shape.name)
    case 'inline-or-reference':
      return `${nameOf(shape.name)} | Ref<${brand(shape.name)}>`
    case 'list':
      return listTs(shapeToTs(shape.inner, nameOf), shape.min, shape.max, shape.inner)
    case 'union':
      return shape.branches.map((b) => shapeToTs(b, nameOf)).join(' | ')
    case 'intersection':
      return shape.branches.map((b) => shapeToTs(b, nameOf)).join(' & ')
    case 'compound-reference': {
      const ref =
        shape.op === 'union'
          ? `Ref<${shape.branches.map(brand).join(' | ')}>`
          : shape.branches.map((b) => `Ref<${brand(b)}>`).join(' & ')
      if (shape.mode === 'ref') return ref
      // inline-or-ref: the inline records of the branches, or a reference.
      if (shape.op === 'union') {
        return `${shape.branches.map(nameOf).join(' | ')} | ${ref}`
      }
      return `(${shape.branches.map(nameOf).join(' & ')}) | (${ref})`
    }
    case 'any':
      // The no-type slot: the type system imposes nothing. `unknown` forces a narrow.
      return 'unknown'
    case 'opaque':
      // The uninterpreted slot: stored verbatim, the engine reads nothing inside.
      // Distinct from `any` (the interpreted top) only in the ENGINE; at the TS
      // type level both are the unconstrained `unknown`.
      return 'unknown'
    case 'def-reference': {
      // A typed reference to a type-DEF, branded distinctly from an instance `Ref`.
      // The bound is the def-axis ceiling; absent ⟹ any def.
      if (shape.bound === undefined) return 'DefRef<string>'
      if (shape.bound.kind === 'single') return `DefRef<${brand(shape.bound.name)}>`
      const sep = shape.bound.op === 'union' ? ' | ' : ' & '
      return `DefRef<${shape.bound.branches.map(brand).join(sep)}>`
    }
    case 'pinned':
      // The `*@` enforced pin is value-level; the type is the inner reference's.
      return shapeToTs(shape.inner, nameOf)
    case 'refined':
      // A value refinement (`Base{predicate}`) narrows the base's value lattice,
      // which TS structural types cannot express (numeric ranges, regex). So the
      // type is the base primitive's; the predicate surfaces as field JSDoc via
      // `refinementDoc`, and the engine remains the validator. This is a
      // deliberate base-narrowing, not a silent drop.
      return PRIMITIVE_TS[shape.base]
    case 'tuple':
      // A fixed-arity positional product → a TS tuple type. Element order is
      // significant, every position required. Reached as a field shape and as a
      // tuple brand's underlying shape.
      return `[${shape.elements.map((e) => shapeToTs(e, nameOf)).join(', ')}]`
    default:
      return assertNeverShape(shape)
  }
}

/**
 * The TS type for a `list` shape, from its element type and `[min..max]` range.
 * One optional-tuple rule spans every cardinality faithfully.
 * - unbounded above (`max` absent): `min===0` → the plain `T[]` / `Array<T>` suffix
 *   form (per `isSimpleElement`); `min>0` → `[T, …min, ...Array<T>]`, a required
 *   prefix then a rest.
 * - bounded above (`max` present): `[T, …min, T?, …(max-min)]`, a required prefix
 *   then optional slots up to `max`, no rest. A fixed length (`min===max`) is the
 *   all-required tuple; `[..m]` (`min===0`) is all-optional.
 * The element sits inside `[...]` in every tuple form, so a union/intersection
 * element needs no `Array<>` guard there — that guard only matters for the plain
 * suffix form.
 */
function listTs(inner: string, min: number, max: number | undefined, innerShape: WireShape): string {
  if (max === undefined) {
    if (min === 0) return isSimpleElement(innerShape) ? `${inner}[]` : `Array<${inner}>`
    const required = Array<string>(min).fill(inner)
    return `[${[...required, `...Array<${inner}>`].join(', ')}]`
  }
  const required = Array<string>(min).fill(inner)
  const optional = Array<string>(Math.max(0, max - min)).fill(`${inner}?`)
  return `[${[...required, ...optional].join(', ')}]`
}

/**
 * A one-line human description of a `refined` shape's predicate, for field JSDoc,
 * or `null` for any other shape. TS types cannot carry the refinement, so this
 * keeps it visible on hover. Only a field's TOP-LEVEL `refined` shape is
 * described; a refinement nested inside a list/union surfaces only in the JSON
 * Schema target, which expresses it fully.
 */
export function refinementDoc(shape: WireShape): string | null {
  if (shape.kind !== 'refined') return null
  return describeRefinement(shape.base, shape.refinement)
}

function describeRefinement(base: string, r: WireRefinement): string {
  const parts: string[] = [base]
  if (r.lower !== undefined) parts.push(`>${r.lower.inclusive ? '=' : ''} ${r.lower.value}`)
  if (r.upper !== undefined) parts.push(`<${r.upper.inclusive ? '=' : ''} ${r.upper.value}`)
  if (r.integer === true) parts.push('integer')
  if (r.pattern !== undefined) parts.push(`pattern /${r.pattern}/`)
  return `Refined ${parts.join(', ')}`
}

/**
 * The canonical type-def names a shape references BY IDENTIFIER — i.e. as a TS
 * type name, not as a `Ref<'name'>` brand. A bare `reference` (`name&` /
 * `name*` in `ref` mode) renders to a branded wikilink string, so it needs no
 * import; only `record` / `inline-or-reference` / inline compound branches put
 * an actual identifier in the output. Drives which borrowed types must be
 * imported.
 */
export function identifierRefsInShape(shape: WireShape): string[] {
  switch (shape.kind) {
    case 'primitive':
    case 'enum':
    case 'reference':
      return []
    case 'record':
    case 'inline-or-reference':
      return [shape.name]
    case 'list':
      return identifierRefsInShape(shape.inner)
    case 'union':
    case 'intersection':
      return shape.branches.flatMap(identifierRefsInShape)
    case 'compound-reference':
      // `ref` mode is all `Ref<…>`; only the inline (`inline-or-ref`) branches name identifiers.
      return shape.mode === 'ref' ? [] : [...shape.branches]
    case 'any':
    case 'opaque':
    case 'def-reference':
      // `any`/`opaque` → `unknown`, `def-reference` → `DefRef<'…'>` (a brand string literal): none names a TS identifier.
      return []
    case 'refined':
      // A base primitive type; names no TS identifier.
      return []
    case 'tuple':
      // A tuple element may name an identifier (a record / inline-or-reference element).
      return shape.elements.flatMap(identifierRefsInShape)
    case 'pinned':
      return identifierRefsInShape(shape.inner)
    default:
      return assertNeverShape(shape)
  }
}
