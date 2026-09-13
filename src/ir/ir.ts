// The IR: a normalized, language-agnostic type graph.
//
// Built from the wire type graph, consumed by per-language emitters. It keeps
// canonical (dotted) names — mapping a name to a target identifier is the
// emitter's job, since casing and collision rules are language-specific.
//
// What the IR adds over the raw wire:
// - a name → type index.
// - sealed-family classification, the reverse lookup (which parent lists a
//   type as a branch) the wire does not carry.
// - shapes decoupled from the wire's snake_case envelope.
//
// See [[spec - typescript codegen - type-defs to branded ts types preserving name and hierarchy]].

import type { WireShape } from '../input/wire.ts'

export interface FieldModel {
  name: string
  /** The parsed shape, or `null` when the upstream parse failed. */
  shape: WireShape | null
  /** Source-form slot expression, kept for comments and diagnostics. */
  sourceShape: string
  required: boolean
  /** The field's `#:` docstring, or `undefined`. Advisory, surfaces as JSDoc. */
  doc?: string
}

/** One field value inside a meta block, its value the raw JSON off the wire. */
export interface MetaFieldModel {
  name: string
  value: unknown
}

/**
 * A meta block carried on a host type-def. Decoupled from the wire envelope.
 * `typeName` is kept verbatim, so it may be `::repo`-qualified; the emitter
 * matches it bare, see [[spec - meta-block constant emission - a type-def meta block surfaces as a generated constant keyed by its host def]].
 */
export interface MetaBlockModel {
  typeName: string
  fields: MetaFieldModel[]
}

/**
 * A type-def's BRAND: a `shape:` def naming a reusable scalar, enum, union, or
 * tuple, instead of `fields:`. Present on a `TypeModel` iff the def is a brand,
 * in which case it emits as a type ALIAS over `shape`, not an interface.
 * See [[spec - typescript codegen - type-defs to branded ts types preserving name and hierarchy]].
 */
export interface BrandModel {
  /** The underlying shape: `primitive`/`refined` (scalar), `enum`, `union`, or `tuple`. */
  shape: WireShape
  /** Per-enum-member `#:` docstrings, `{ member: doc }`, documented members only. Absent for non-enum or undocumented. */
  memberDocs?: Record<string, string>
}

export interface TypeModel {
  /** Canonical name, e.g. `decision.decided`. */
  name: string
  /** The type-def's `#:` head docstring, or `undefined`. Advisory, surfaces as JSDoc. */
  doc?: string
  /** Canonical parent names, from the type-def's `type:` claim. */
  parents: string[]
  /** The type's own declared fields, not the effective shape. */
  fields: FieldModel[]
  /** Leaf names if this type is a sealed parent, `null` otherwise. Never empty. */
  sealed: string[] | null
  /** The sealed parent that lists this type as a branch, `null` otherwise. */
  sealedParent: string | null
  /** True when some type lists this one in its `parents` — i.e. it is extended. The general reverse lookup, sealed or open. */
  extended: boolean
  /** Declared meta blocks on this type-def, `[]` when none. Drives meta-block emission. */
  meta: MetaBlockModel[]
  /**
   * The brand, when this def declares `shape:` instead of `fields:`, `undefined`
   * otherwise. A branded def emits as a type alias over its shape, bypassing the
   * interface / discriminant / block-id machinery; its `fields` is empty.
   */
  brand?: BrandModel
}

export interface TypeGraphIR {
  /** All types, in input order. */
  types: TypeModel[]
  /** Lookup by canonical name. */
  byName: Map<string, TypeModel>
}
