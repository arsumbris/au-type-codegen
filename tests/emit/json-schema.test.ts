import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, test } from 'vitest'
import { buildIR } from '../../src/ir/build.ts'
import { emitJsonSchema } from '../../src/emit/json-schema/emit.ts'
import { shapeToJsonSchema, type JsonSchema, type SchemaCtx } from '../../src/emit/json-schema/schema.ts'
import { toTsTypeName } from '../../src/emit/ts/names.ts'
import type { WireShape, WireTypeDef } from '../../src/input/wire.ts'
import { fixtureGraph, toolInputGraph } from '../fixtures/type-graphs.ts'

// A ctx that records nothing — for isolated shape mapping.
const noopCtx: SchemaCtx = { nameOf: toTsTypeName, needDef: () => {} }
const newAjv = () => new Ajv2020({ strict: false })

describe('shapeToJsonSchema', () => {
  const cases: Array<[string, WireShape, JsonSchema]> = [
    ['String', { kind: 'primitive', name: 'String' }, { type: 'string' }],
    ['Number', { kind: 'primitive', name: 'Number' }, { type: 'number' }],
    ['Boolean', { kind: 'primitive', name: 'Boolean' }, { type: 'boolean' }],
    ['Date', { kind: 'primitive', name: 'Date' }, { type: 'string', format: 'date' }],
    ['DateTime', { kind: 'primitive', name: 'DateTime' }, { type: 'string', format: 'date-time' }],
    ['Url', { kind: 'primitive', name: 'Url' }, { type: 'string', format: 'uri' }],
    ['enum', { kind: 'enum', members: ['low', 'high'] }, { type: 'string', enum: ['low', 'high'] }],
    ['reference', { kind: 'reference', name: 'decision' }, { type: 'string', description: 'reference to decision' }],
    ['record', { kind: 'record', name: 'decision' }, { $ref: '#/$defs/Decision' }],
    ['list', { kind: 'list', min: 0, inner: { kind: 'primitive', name: 'String' } }, { type: 'array', items: { type: 'string' } }],
    ['non-empty list (min 1)', { kind: 'list', min: 1, inner: { kind: 'primitive', name: 'String' } }, { type: 'array', minItems: 1, items: { type: 'string' } }],
    ['fixed-length list (min===max)', { kind: 'list', min: 3, max: 3, inner: { kind: 'primitive', name: 'String' } }, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } }],
    ['bounded range list [2..4]', { kind: 'list', min: 2, max: 4, inner: { kind: 'primitive', name: 'String' } }, { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } }],
    ['upper-bound only list [..2]', { kind: 'list', min: 0, max: 2, inner: { kind: 'primitive', name: 'String' } }, { type: 'array', maxItems: 2, items: { type: 'string' } }],
    ['refined Number, inclusive lower + integer', { kind: 'refined', base: 'Number', refinement: { lower: { value: '0', inclusive: true }, integer: true } }, { type: 'integer', minimum: 0 }],
    ['refined Number, exclusive bounds', { kind: 'refined', base: 'Number', refinement: { lower: { value: '0', inclusive: false }, upper: { value: '10', inclusive: false } } }, { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 }],
    ['refined String, pattern', { kind: 'refined', base: 'String', refinement: { pattern: '^[a-z0-9-]+$' } }, { type: 'string', pattern: '^[a-z0-9-]+$' }],
    ['refined Date, bounds fold into description', { kind: 'refined', base: 'Date', refinement: { lower: { value: '2020-01-01', inclusive: true } } }, { type: 'string', format: 'date', description: '>= 2020-01-01' }],
    ['compound-reference ref', { kind: 'compound-reference', mode: 'ref', op: 'union', branches: ['a', 'b'] }, { type: 'string' }],
    ['any', { kind: 'any' }, {}],
    // `opaque` is the uninterpreted slot; unconstrained, the same empty schema as `any`.
    ['opaque', { kind: 'opaque' }, {}],
    ['def-reference', { kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool' } }, { type: 'string' }],
    ['def-reference unbound', { kind: 'def-reference' }, { type: 'string' }],
    ['pinned reference is its inner schema', { kind: 'pinned', inner: { kind: 'reference', name: 'decision' } }, { type: 'string', description: 'reference to decision' }],
    [
      'tuple → prefixItems, fixed arity',
      { kind: 'tuple', elements: [{ kind: 'primitive', name: 'Number' }, { kind: 'primitive', name: 'String' }] },
      { type: 'array', prefixItems: [{ type: 'number' }, { type: 'string' }], items: false, minItems: 2, maxItems: 2 },
    ],
  ]
  test.each(cases)('%s', (_label, shape, expected) => {
    expect(shapeToJsonSchema(shape, noopCtx)).toEqual(expected)
  })
})

describe('emitJsonSchema — toolInput tools', () => {
  const ir = buildIR(toolInputGraph)

  test('read_file is a strict object with the right required set', () => {
    const schema = emitJsonSchema(ir, 'toolInput.read_file')
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties).toEqual({
      file_path: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    })
    expect(schema.required).toEqual(['file_path'])
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
  })

  test('every tool schema is valid Draft 2020-12 and enforces its contract', () => {
    for (const tool of ['toolInput.read_file', 'toolInput.edit_file']) {
      const schema = emitJsonSchema(ir, tool)
      const validate = newAjv().compile(schema) // throws if the schema itself is malformed
      expect(typeof validate).toBe('function')
    }
    const validate = newAjv().compile(emitJsonSchema(ir, 'toolInput.read_file'))
    expect(validate({ file_path: 'a.md' })).toBe(true)
    expect(validate({ file_path: 'a.md', offset: 2 })).toBe(true)
    expect(validate({})).toBe(false) // missing required file_path
    expect(validate({ file_path: 'a.md', bogus: 1 })).toBe(false) // additionalProperties: false
  })
})

describe('emitJsonSchema — hierarchy, sealed, $defs', () => {
  const ir = buildIR(fixtureGraph)

  test('flattens the effective shape across the parent chain', () => {
    const schema = emitJsonSchema(ir, 'decision.decided')
    const props = Object.keys(schema.properties ?? {})
    // own (decided) + inherited (decision, note) + the discriminant
    expect(props).toContain('description') // from note
    expect(props).toContain('rationale') // from decision
    expect(props).toContain('status') // from decision.decided
    expect(schema.properties?.['type']).toEqual({ const: 'decision.decided' })
    expect(schema.required).toContain('type')
    expect(schema.required).toContain('status')
  })

  test('a sealed parent emits a discriminable oneOf with leaves in $defs', () => {
    const schema = emitJsonSchema(ir, 'decision')
    expect(schema.oneOf).toEqual([{ $ref: '#/$defs/DecisionPending' }, { $ref: '#/$defs/DecisionDecided' }])
    expect(schema.$defs?.['DecisionDecided']?.properties?.['type']).toEqual({ const: 'decision.decided' })
  })

  test('record references land in $defs', () => {
    const schema = emitJsonSchema(ir, 'decision.decided')
    // assumptions?: assumption&[+] → Assumption enters $defs
    expect(schema.$defs?.['Assumption']?.type).toBe('object')
  })

  test('the whole document validates as Draft 2020-12', () => {
    expect(() => newAjv().compile(emitJsonSchema(ir, 'decision'))).not.toThrow()
  })
})

describe('emitJsonSchema — recursion terminates via $ref', () => {
  const treeGraph: WireTypeDef[] = [
    {
      name: 'node',
      parents: [],
      sealed: null,
      fields: [
        { name: 'value', shape: 'String', shape_ast: { kind: 'primitive', name: 'String' }, required: true },
        { name: 'children', shape: 'node[]', shape_ast: { kind: 'list', min: 0, inner: { kind: 'record', name: 'node' } }, required: false },
      ],
    },
  ]

  test('a self-referential record compiles', () => {
    const schema = emitJsonSchema(buildIR(treeGraph), 'node')
    expect(schema.$defs?.['Node']?.type).toBe('object')
    expect(schema.properties?.['children']).toEqual({ type: 'array', items: { $ref: '#/$defs/Node' } })
    expect(() => newAjv().compile(schema)).not.toThrow()
  })
})
