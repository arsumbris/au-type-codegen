// Build the IR from the wire type graph.

import { CodegenError } from '../errors.ts'
import type { WireTypeDef } from '../input/wire.ts'
import type { TypeGraphIR, TypeModel } from './ir.ts'

/**
 * Universal engine markers: fieldless, abstract `au.engine.*` builtins that a
 * type-def mixes in as a nominal tag, never as a data supertype. Schema 18's
 * NOMINAL-META RULE makes every meta type carry `au.engine.meta::au-engine`.
 *
 * They are dropped from `parents` here, so the rest of codegen never sees them:
 * they carry no fields to inherit, own no TS module to import, and re-declare
 * nothing. The engine owns exactly one such marker; a future one is a one-line
 * add. Recognized by bare name (owner-agnostic), so a `::au-engine`-qualified
 * borrow and au-engine's own bare read both match. This is NOT the whole
 * `au.engine.*` namespace: the field-bearing config builtins (`au.engine.repo`,
 * `au.engine.dep`, `au.engine.workspace`, ...) are ordinary borrows and flow
 * through the normal owned/borrowed path untouched.
 * See au-engine `engine_schema.rs` (the `abstract: true`, `fields: []` marker
 * base) and [[spec - meta-block constant emission ...]].
 */
const UNIVERSAL_MARKERS = new Set(['au.engine.meta'])

/** True when a parent reference names a universal engine marker, bare or `::repo`-qualified. */
function isUniversalMarker(parent: string): boolean {
  const idx = parent.indexOf('::')
  const bare = idx < 0 ? parent : parent.slice(0, idx)
  return UNIVERSAL_MARKERS.has(bare)
}

export function buildIR(defs: WireTypeDef[]): TypeGraphIR {
  const byName = new Map<string, TypeModel>()

  for (const def of defs) {
    if (byName.has(def.name)) {
      throw new CodegenError(`duplicate type-def name '${def.name}'`)
    }
    byName.set(def.name, {
      name: def.name,
      doc: def.doc,
      parents: def.parents.filter((p) => !isUniversalMarker(p)),
      fields: def.fields.map((f) => ({
        name: f.name,
        shape: f.shape_ast,
        sourceShape: f.shape,
        required: f.required,
        doc: f.doc,
      })),
      sealed: def.sealed ? [...def.sealed] : null,
      sealedParent: null,
      extended: false,
      // The wire sends `null` when no `meta:` key (`[]` for the suppression marker);
      // both normalize to an empty list here. `type_name` is kept verbatim (may be
      // `::repo`-qualified), the emitter matches it bare.
      meta: (def.meta_blocks ?? []).map((block) => ({
        typeName: block.type_name,
        fields: block.body.map((f) => ({ name: f.name, value: f.value })),
      })),
      // A `shape:` brand def carries `brand` and an empty `fields`; a record def
      // carries no `brand`. `member_docs` (snake) normalizes to `memberDocs`.
      brand: def.brand ? { shape: def.brand.shape, memberDocs: def.brand.member_docs } : undefined,
    })
  }

  // Classify leaves: a type listed in some parent's `sealed:` is a branch of it.
  // A type can be both a leaf and a sealed parent (a nested sum).
  for (const type of byName.values()) {
    if (!type.sealed) continue
    for (const leafName of type.sealed) {
      const leaf = byName.get(leafName)
      // A dangling leaf (listed but absent) is impossible from the engine; a
      // future file-source adapter would validate it. Skip silently for now.
      if (leaf) leaf.sealedParent = type.name
    }
  }

  // The general reverse lookup: mark a type extended when some type names it as a
  // parent (sealed via `sealed:` or open via an `extends:` parent). Drives the
  // open-hierarchy `type` discriminant — a base gets `type: string`.
  for (const type of byName.values()) {
    for (const parentName of type.parents) {
      const parent = byName.get(parentName)
      if (parent) parent.extended = true
    }
  }

  return { types: [...byName.values()], byName }
}
