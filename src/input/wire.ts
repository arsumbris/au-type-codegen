// The input contract: the engine's type graph as served over the wire.
//
// Consumed from au-engine-sdk's renderer-safe `reads` subpath. The engine
// parses each slot shape into `shape_ast`, so codegen maps structure to TS
// and never parses the slot grammar itself.
// Contract: [[spec - shape ast on the wire - the parsed slot shape as a tagged union beside the source string::au-engine]]
//
// We re-export the shape types and `WireField` verbatim, and keep a trimmed
// `WireTypeDef` view of only the fields codegen reads. The SDK's richer
// `WireTypeDef` (with repo, hash, body, source) is structurally assignable
// to this view, so a live `types` read feeds straight in.
//
// A repo-scoped `types` read returns the repo's OWN defs only. A cross-repo
// dependency never arrives as its own def here — it surfaces as a `::repo`-
// qualified reference inside an owned def's `parents` / field `shape_ast`. So
// codegen tells owned from borrowed by the qualifier, not by a provenance
// field. (The `upstream:` vendored-copy marker that used to carry this was
// removed from the wire at schema 14.)

export type { WireBrand, WireField, WireMetaBlock, WireMetaField, WirePrimitiveName, WireRefinement, WireShape } from '@arsumbris/au-engine-sdk/reads'

import type { WireBrand, WireField, WireMetaBlock } from '@arsumbris/au-engine-sdk/reads'

/** The subset of the SDK's type-def introspection codegen consumes. */
export interface WireTypeDef {
  name: string
  parents: string[]
  /** The sealed branch list, or `null` when not sealed. Never empty. */
  sealed: string[] | null
  fields: WireField[]
  /**
   * The type-def's own `#:` head docstring; advisory, never validated. Absent
   * when none. Surfaces as JSDoc on the generated type. The SDK's richer
   * `WireTypeDef` already carries this (`reads.ts`), the earlier assumption that
   * the wire dropped docstrings was stale. `WireField` (re-exported verbatim)
   * carries its own field-level `doc?` likewise.
   */
  doc?: string
  /**
   * Declared meta sub-regions, or `null` when the `meta:` key is absent (`[]` for
   * the explicit `meta: []` suppression marker). Drives meta-block emission, see
   * [[spec - meta-block constant emission - a type-def meta block surfaces as a generated constant keyed by its host def]].
   * Optional in this trimmed view, so fixtures may omit it; the live SDK read
   * always carries it and stays structurally assignable.
   */
  meta_blocks?: WireMetaBlock[] | null
  /**
   * The type-def's BRAND, present when it declares a `shape:` instead of
   * `fields:` (a branded scalar, named enum, named union, or tuple); then
   * `fields` is empty. Absent for a record def. Drives brand emission, see
   * [[spec - typescript codegen - type-defs to branded ts types preserving name and hierarchy]].
   * A brand's underlying `shape` is a `WireShape`, the same AST a field's
   * `shape_ast` uses. Optional in this trimmed view; the live SDK read carries
   * it (`WireTypeDef.brand?`) and stays structurally assignable.
   */
  brand?: WireBrand
}

/** Result of the `types` read: the whole graph. */
export type WireTypesResult = WireTypeDef[]
