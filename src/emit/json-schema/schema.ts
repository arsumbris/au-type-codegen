// Map a parsed WireShape to a JSON Schema (Draft 2020-12) fragment.
//
// References are wikilink strings, so `T*` is a string. Record shapes enter
// `$defs` and are reached by `$ref`, so recursion terminates. The driving
// target is au-mcp tool `inputSchema`.
//
// See [[spec - json schema codegen - toolinput type-defs to mcp inputschema draft 2020-12]].

import { assertNeverShape } from '../../errors.ts'
import type { WirePrimitiveName, WireRefinement, WireShape } from '../../input/wire.ts'

/** A JSON Schema node. Permissive on purpose, the emitter only sets the keys it needs. */
export interface JsonSchema {
  $schema?: string
  $ref?: string
  $defs?: Record<string, JsonSchema>
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  format?: string
  enum?: string[]
  const?: string
  description?: string
  title?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema | boolean
  prefixItems?: JsonSchema[]
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  pattern?: string
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

/** Collaborates with the emitter: maps a canonical name to its `$defs` key, and records which types need a `$def`. */
export interface SchemaCtx {
  nameOf: (canonical: string) => string
  needDef: (canonical: string) => void
}

const PRIMITIVE: Record<WirePrimitiveName, JsonSchema> = {
  String: { type: 'string' },
  Number: { type: 'number' },
  Boolean: { type: 'boolean' },
  Date: { type: 'string', format: 'date' },
  DateTime: { type: 'string', format: 'date-time' },
  Url: { type: 'string', format: 'uri' },
}

const defRef = (ctx: SchemaCtx, name: string): JsonSchema => {
  ctx.needDef(name)
  return { $ref: `#/$defs/${ctx.nameOf(name)}` }
}

export function shapeToJsonSchema(shape: WireShape, ctx: SchemaCtx): JsonSchema {
  switch (shape.kind) {
    case 'primitive':
      return { ...PRIMITIVE[shape.name] }
    case 'enum':
      return { type: 'string', enum: [...shape.members] }
    case 'reference':
      return { type: 'string', description: `reference to ${shape.name}` }
    case 'record':
      return defRef(ctx, shape.name)
    case 'inline-or-reference':
      return { anyOf: [defRef(ctx, shape.name), { type: 'string' }] }
    case 'list': {
      const items = shapeToJsonSchema(shape.inner, ctx)
      const out: JsonSchema = { type: 'array', items }
      // `[min..max]` cardinality → `minItems` / `maxItems`. `min===0` omits the
      // floor (the default); `max` absent is unbounded above.
      if (shape.min > 0) out.minItems = shape.min
      if (shape.max !== undefined) out.maxItems = shape.max
      return out
    }
    case 'union':
      return { anyOf: shape.branches.map((b) => shapeToJsonSchema(b, ctx)) }
    case 'intersection':
      return { allOf: shape.branches.map((b) => shapeToJsonSchema(b, ctx)) }
    case 'compound-reference': {
      if (shape.mode === 'ref') return { type: 'string' }
      return { anyOf: [...shape.branches.map((b) => defRef(ctx, b)), { type: 'string' }] }
    }
    case 'any':
      // The no-type slot: any value, the type system imposes nothing.
      return {}
    case 'opaque':
      // The uninterpreted slot: unconstrained, same empty schema as `any`. The
      // engine stores it verbatim and reads nothing; the schema imposes nothing.
      return {}
    case 'def-reference':
      // A wikilink to a type-def file; a string at runtime, like a reference.
      return { type: 'string' }
    case 'pinned':
      // The `*@` enforced pin is value-level; the schema is the inner shape's.
      return shapeToJsonSchema(shape.inner, ctx)
    case 'refined':
      // A value refinement (`Base{predicate}`) maps onto the base's schema plus
      // JSON Schema's own constraint keywords — the faithful, high-value target.
      return refinedToJsonSchema(shape.base, shape.refinement)
    case 'tuple': {
      // A fixed-arity positional product → Draft 2020-12 `prefixItems`, one schema
      // per position, `items: false` forbidding extras, and min/maxItems pinning
      // the exact arity so every position is required.
      const prefixItems = shape.elements.map((e) => shapeToJsonSchema(e, ctx))
      return { type: 'array', prefixItems, items: false, minItems: prefixItems.length, maxItems: prefixItems.length }
    }
    default:
      return assertNeverShape(shape)
  }
}

/**
 * A `refined` shape to JSON Schema: the base primitive's schema narrowed by the
 * predicate. `Number` maps losslessly (`integer` → `type: 'integer'`, bounds →
 * `minimum` / `maximum` or their `exclusive*` variants, wire string values
 * parsed to numbers); `String` → `pattern`. `Date` / `DateTime` bounds have no
 * standard keyword over date-strings, so they fold into `description`, keeping
 * the `format` intact. Which members appear is fixed by `base` (see the wire
 * producer invariant), so the untouched arms are simply absent.
 */
function refinedToJsonSchema(base: WirePrimitiveName, r: WireRefinement): JsonSchema {
  const out: JsonSchema = { ...PRIMITIVE[base] }
  if (base === 'Number') {
    if (r.integer === true) out.type = 'integer'
    if (r.lower !== undefined) {
      const v = Number(r.lower.value)
      if (r.lower.inclusive) out.minimum = v
      else out.exclusiveMinimum = v
    }
    if (r.upper !== undefined) {
      const v = Number(r.upper.value)
      if (r.upper.inclusive) out.maximum = v
      else out.exclusiveMaximum = v
    }
  } else if (base === 'String') {
    if (r.pattern !== undefined) out.pattern = r.pattern
  } else if (base === 'Date' || base === 'DateTime') {
    const notes = boundNotes(r)
    if (notes !== undefined) out.description = notes
  }
  return out
}

/** A `>=`/`>`/`<=`/`<` note for a refinement's bounds, for a base JSON Schema cannot range-check. */
function boundNotes(r: WireRefinement): string | undefined {
  const parts: string[] = []
  if (r.lower !== undefined) parts.push(`>${r.lower.inclusive ? '=' : ''} ${r.lower.value}`)
  if (r.upper !== undefined) parts.push(`<${r.upper.inclusive ? '=' : ''} ${r.upper.value}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}
