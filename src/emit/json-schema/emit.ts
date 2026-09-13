// The JSON Schema emitter: a TypeGraphIR plus a type name to one self-contained
// Draft 2020-12 document. Effective shape flattened (JSON Schema has no
// `extends`), referenced records carried in `$defs`.
//
// See [[spec - json schema codegen - toolinput type-defs to mcp inputschema draft 2020-12]].

import { CodegenError } from '../../errors.ts'
import type { FieldModel, TypeGraphIR, TypeModel } from '../../ir/ir.ts'
import { toTsTypeName } from '../ts/names.ts'
import { type JsonSchema, type SchemaCtx, shapeToJsonSchema } from './schema.ts'

const DRAFT = 'https://json-schema.org/draft/2020-12/schema'

export function emitJsonSchema(ir: TypeGraphIR, typeName: string): JsonSchema {
  const root = ir.byName.get(typeName)
  if (root === undefined) throw new CodegenError(`unknown type '${typeName}'`)

  const needed = new Set<string>()
  const ctx: SchemaCtx = { nameOf: toTsTypeName, needDef: (c) => needed.add(c) }

  const rootSchema = schemaForType(root, ir, ctx)

  // Resolve `$defs` transitively: each referenced record may reference more.
  const defs: Record<string, JsonSchema> = {}
  const queue = [...needed]
  while (queue.length > 0) {
    const canonical = queue.shift() as string
    const key = toTsTypeName(canonical)
    if (key in defs) continue
    const type = ir.byName.get(canonical)
    // An absent referenced type stays permissive rather than failing the whole doc.
    defs[key] = type === undefined ? {} : schemaForType(type, ir, ctx)
    for (const c of needed) if (!(toTsTypeName(c) in defs)) queue.push(c)
  }

  const doc: JsonSchema = { $schema: DRAFT, title: typeName, ...rootSchema }
  if (Object.keys(defs).length > 0) doc.$defs = defs
  return doc
}

/**
 * A brand def is its underlying shape's schema (a branded scalar → the primitive,
 * an enum → a string enum, a tuple → a `prefixItems` array, a union → `anyOf`); a
 * sealed parent becomes a `oneOf` of its leaves; everything else an object. A
 * field referencing a brand by bare name resolves here through its `$def`.
 */
function schemaForType(type: TypeModel, ir: TypeGraphIR, ctx: SchemaCtx): JsonSchema {
  if (type.brand !== undefined) {
    const schema = shapeToJsonSchema(type.brand.shape, ctx)
    // Per-member enum docs have no JSON Schema slot; fold them into the description
    // so the documented ladder is not lost (mirrors the TS target's JSDoc).
    if (type.brand.shape.kind === 'enum' && type.brand.memberDocs !== undefined) {
      const docs = type.brand.memberDocs
      const lines = type.brand.shape.members.filter((m) => docs[m] !== undefined).map((m) => `${m}: ${docs[m]}`)
      if (lines.length > 0) schema.description = lines.join('; ')
    }
    return schema
  }
  if (type.sealed !== null) {
    return { oneOf: type.sealed.map((leaf) => shapeToDefRef(leaf, ctx)) }
  }
  return objectSchema(type, ir, ctx)
}

function shapeToDefRef(canonical: string, ctx: SchemaCtx): JsonSchema {
  ctx.needDef(canonical)
  return { $ref: `#/$defs/${ctx.nameOf(canonical)}` }
}

function objectSchema(type: TypeModel, ir: TypeGraphIR, ctx: SchemaCtx): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  // A terminal sealed-family leaf carries the `type` discriminant as a const,
  // so a sealed `oneOf` is discriminable, mirroring the TS emitter.
  if (type.sealedParent !== null && type.sealed === null) {
    properties['type'] = { const: type.name }
    required.push('type')
  }

  for (const field of effectiveFields(type, ir)) {
    properties[field.name] = field.shape ? shapeToJsonSchema(field.shape, ctx) : {}
    if (field.required) required.push(field.name)
  }

  const schema: JsonSchema = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) schema.required = required
  return schema
}

/** Own fields plus all inherited, parents first. Width-only subtyping means no name conflicts. */
function effectiveFields(type: TypeModel, ir: TypeGraphIR): FieldModel[] {
  const seen = new Set<string>()
  const out: FieldModel[] = []
  const visit = (t: TypeModel): void => {
    for (const parent of t.parents) {
      const pt = ir.byName.get(parent)
      if (pt !== undefined) visit(pt)
    }
    for (const f of t.fields) {
      if (!seen.has(f.name)) {
        seen.add(f.name)
        out.push(f)
      }
    }
  }
  visit(type)
  return out
}
