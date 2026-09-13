import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, test } from 'vitest'
import { emitJsonSchema } from '../../src/emit/json-schema/emit.ts'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import type { WireTypeDef } from '../../src/input/wire.ts'
import { brandGraph } from '../fixtures/type-graphs.ts'

// A `shape:` brand def emits as a TYPE ALIAS over its underlying shape, not an
// interface. Nominal shapes (scalar / tuple) carry a `& { __brand }` tag; enum /
// union stay structural. A field referencing a brand by bare name resolves to
// the alias (TS) / `$def` (JSON Schema).
// See [[spec - typescript codegen - type-defs to branded ts types preserving name and hierarchy]].

const newAjv = () => new Ajv2020({ strict: false })

describe('buildIR — brands', () => {
  const ir = buildIR(brandGraph)

  test('a brand def carries `brand` and empty fields; a record def carries no brand', () => {
    const meter = ir.byName.get('meter')
    expect(meter?.brand?.shape).toEqual({ kind: 'primitive', name: 'Number' })
    expect(meter?.fields).toEqual([])
    expect(ir.byName.get('gauge')?.brand).toBeUndefined()
  })

  test('enum member docs normalize from snake `member_docs` to `memberDocs`', () => {
    expect(ir.byName.get('icon-role')?.brand?.memberDocs).toEqual({ save: 'persist current state', delete: 'remove the target' })
  })
})

describe('emitTypeScript — brands', () => {
  const out = emitTypeScript(buildIR(brandGraph))

  test('a branded scalar is a nominal alias over its primitive', () => {
    expect(out).toContain("export type Meter = number & { readonly __brand: 'meter' }")
  })

  test('a refined branded scalar narrows to its base, still branded', () => {
    expect(out).toContain("export type Percent = number & { readonly __brand: 'percent' }")
  })

  test('a tuple brand is a nominal alias over the tuple type', () => {
    expect(out).toContain("export type Rect = [number, number, number, number] & { readonly __brand: 'rect' }")
  })

  test('an enum brand is a STRUCTURAL literal union — no brand tag', () => {
    expect(out).toContain('export type IconRole = ')
    expect(out).toMatch(/export type IconRole = 'save' \| 'delete' \| 'open'/)
    // No nominal brand tag on the enum.
    expect(out).not.toMatch(/IconRole =[^\n]*__brand/)
  })

  test('a union brand is a STRUCTURAL branch union — no brand tag', () => {
    expect(out).toContain('export type EvidenceKind = Paper | Observation')
    expect(out).not.toMatch(/EvidenceKind =[^\n]*__brand/)
  })

  test('the head docstring and per-member docs surface as JSDoc on the enum brand', () => {
    expect(out).toContain('semantic icon roles')
    expect(out).toContain('- `save`: persist current state')
    expect(out).toContain('- `delete`: remove the target')
  })

  test('a brand emits as an alias, never an interface / discriminant / block-id', () => {
    expect(out).not.toContain('export interface Meter')
    expect(out).not.toContain('export interface Rect')
    // No `type?:` discriminant or `'^'?:` block-id leaks onto a brand.
    expect(out).not.toMatch(/Meter = [^\n]*type\?/)
  })

  test('a field referencing a brand by bare name resolves to the brand alias', () => {
    expect(out).toContain('  length: Meter')
    expect(out).toContain('  ratio?: Percent')
    expect(out).toContain('  role?: IconRole')
    expect(out).toContain('  box?: Rect')
    expect(out).toContain('  evidence?: EvidenceKind')
  })

  test('the whole module type-checks (no dangling identifiers)', () => {
    // A union brand names Paper / Observation by identifier; both are owned defs
    // emitted in the same module, so no import is needed and nothing dangles.
    expect(out).toContain('export interface Paper')
    expect(out).toContain('export interface Observation')
  })
})

describe('emitTypeScript — a union brand referencing a BORROWED record imports it', () => {
  // A structural union brand whose member is a `::repo` record must import that
  // identifier, exactly like a field reference would.
  const borrowUnion: WireTypeDef[] = [
    {
      name: 'evidence-kind',
      parents: [],
      sealed: null,
      fields: [],
      brand: { shape: { kind: 'union', branches: [{ kind: 'record', name: 'paper::corpus' }, { kind: 'record', name: 'observation' }] } },
    },
    { name: 'observation', parents: [], sealed: null, fields: [{ name: 'seen', shape: 'String', shape_ast: { kind: 'primitive', name: 'String' }, required: true }] },
  ]

  test('the borrowed union member is imported from its owner module', () => {
    const out = emitTypeScript(buildIR(borrowUnion), { moduleMap: new Map([['corpus', '@arsumbris/corpus']]) })
    expect(out).toContain("import type { Paper } from '@arsumbris/corpus'")
    expect(out).toContain('export type EvidenceKind = Paper | Observation')
  })
})

describe('emitJsonSchema — brands', () => {
  const ir = buildIR(brandGraph)

  test('a branded scalar `$def` is its underlying primitive schema', () => {
    // `gauge.length: meter` → $ref to Meter, whose $def is a plain number.
    const schema = emitJsonSchema(ir, 'gauge')
    expect(schema.properties?.['length']).toEqual({ $ref: '#/$defs/Meter' })
    expect(schema.$defs?.['Meter']).toEqual({ type: 'number' })
  })

  test('a refined branded scalar `$def` carries the refinement keywords', () => {
    const schema = emitJsonSchema(ir, 'gauge')
    expect(schema.$defs?.['Percent']).toEqual({ type: 'number', minimum: 0, maximum: 100 })
  })

  test('an enum brand `$def` is a string enum, member docs folded into description', () => {
    const schema = emitJsonSchema(ir, 'gauge')
    expect(schema.$defs?.['IconRole']?.type).toBe('string')
    expect(schema.$defs?.['IconRole']?.enum).toEqual(['save', 'delete', 'open'])
    expect(schema.$defs?.['IconRole']?.description).toContain('save: persist current state')
  })

  test('a tuple brand `$def` is a fixed-arity prefixItems array', () => {
    const schema = emitJsonSchema(ir, 'gauge')
    expect(schema.$defs?.['Rect']).toEqual({
      type: 'array',
      prefixItems: [{ type: 'number' }, { type: 'number' }, { type: 'number' }, { type: 'number' }],
      items: false,
      minItems: 4,
      maxItems: 4,
    })
  })

  test('a union brand `$def` is an anyOf over its members', () => {
    const schema = emitJsonSchema(ir, 'gauge')
    expect(schema.$defs?.['EvidenceKind']?.anyOf).toEqual([{ $ref: '#/$defs/Paper' }, { $ref: '#/$defs/Observation' }])
  })

  test('the whole document is valid Draft 2020-12 and enforces the brands', () => {
    const schema = emitJsonSchema(ir, 'gauge')
    const validate = newAjv().compile(schema)
    expect(validate({ length: 5 })).toBe(true)
    expect(validate({ length: 5, ratio: 50 })).toBe(true)
    expect(validate({ length: 5, ratio: 150 })).toBe(false) // percent > 100
    expect(validate({ length: 5, role: 'save' })).toBe(true)
    expect(validate({ length: 5, role: 'bogus' })).toBe(false) // not an icon-role member
    expect(validate({ length: 5, box: [1, 2, 3, 4] })).toBe(true)
    expect(validate({ length: 5, box: [1, 2, 3] })).toBe(false) // wrong tuple arity
    expect(validate({})).toBe(false) // length required
  })
})
