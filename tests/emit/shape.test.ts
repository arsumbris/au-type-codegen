import { describe, expect, test } from 'vitest'
import type { WireShape } from '../../src/input/wire.ts'
import { shapeToTs } from '../../src/emit/ts/shape.ts'
import { toTsTypeName } from '../../src/emit/ts/names.ts'

// Isolated shape mapping: nameOf is the bare PascalCase mapping.
const nameOf = toTsTypeName

const ref = (name: string): WireShape => ({ kind: 'reference', name })

const cases: Array<[string, WireShape, string]> = [
  ['primitive String', { kind: 'primitive', name: 'String' }, 'string'],
  ['primitive Number', { kind: 'primitive', name: 'Number' }, 'number'],
  ['primitive Boolean', { kind: 'primitive', name: 'Boolean' }, 'boolean'],
  ['primitive Date', { kind: 'primitive', name: 'Date' }, 'string'],
  ['primitive DateTime', { kind: 'primitive', name: 'DateTime' }, 'string'],
  ['primitive Url', { kind: 'primitive', name: 'Url' }, 'string'],
  ['enum', { kind: 'enum', members: ['low', 'high'] }, "'low' | 'high'"],
  ['reference', ref('decision'), "Ref<'decision'>"],
  ['reference file', ref('file'), "Ref<'file'>"],
  ['record', { kind: 'record', name: 'decision' }, 'Decision'],
  ['inline-or-reference', { kind: 'inline-or-reference', name: 'decision' }, "Decision | Ref<'decision'>"],
  ['list of reference', { kind: 'list', min: 0, inner: ref('decision') }, "Ref<'decision'>[]"],
  ['list of primitive', { kind: 'list', min: 0, inner: { kind: 'primitive', name: 'String' } }, 'string[]'],
  ['list of union uses Array<>', { kind: 'list', min: 0, inner: { kind: 'inline-or-reference', name: 'decision' } }, "Array<Decision | Ref<'decision'>>"],
  ['non-empty list (min 1)', { kind: 'list', min: 1, inner: ref('decision') }, "[Ref<'decision'>, ...Array<Ref<'decision'>>]"],
  ['lower-bound list (min 2)', { kind: 'list', min: 2, inner: ref('decision') }, "[Ref<'decision'>, Ref<'decision'>, ...Array<Ref<'decision'>>]"],
  ['fixed-length list (min===max)', { kind: 'list', min: 3, max: 3, inner: { kind: 'primitive', name: 'Number' } }, '[number, number, number]'],
  ['bounded range list [2..4]', { kind: 'list', min: 2, max: 4, inner: { kind: 'primitive', name: 'String' } }, '[string, string, string?, string?]'],
  ['upper-bound only list [..2]', { kind: 'list', min: 0, max: 2, inner: { kind: 'primitive', name: 'String' } }, '[string?, string?]'],
  ['refined Number narrows to base', { kind: 'refined', base: 'Number', refinement: { lower: { value: '0', inclusive: true }, integer: true } }, 'number'],
  ['refined String narrows to base', { kind: 'refined', base: 'String', refinement: { pattern: '^[a-z]+$' } }, 'string'],
  ['list of refined uses base suffix form', { kind: 'list', min: 0, inner: { kind: 'refined', base: 'Number', refinement: { integer: true } } }, 'number[]'],
  ['union', { kind: 'union', branches: [ref('a'), ref('b')] }, "Ref<'a'> | Ref<'b'>"],
  ['intersection', { kind: 'intersection', branches: [ref('a'), ref('b')] }, "Ref<'a'> & Ref<'b'>"],
  ['compound-reference ref/union', { kind: 'compound-reference', mode: 'ref', op: 'union', branches: ['a', 'b'] }, "Ref<'a' | 'b'>"],
  ['compound-reference ref/intersection', { kind: 'compound-reference', mode: 'ref', op: 'intersection', branches: ['a', 'b'] }, "Ref<'a'> & Ref<'b'>"],
  ['compound-reference inline/union', { kind: 'compound-reference', mode: 'inline-or-ref', op: 'union', branches: ['a', 'b'] }, "A | B | Ref<'a' | 'b'>"],
  ['compound-reference inline/intersection', { kind: 'compound-reference', mode: 'inline-or-ref', op: 'intersection', branches: ['a', 'b'] }, "(A & B) | (Ref<'a'> & Ref<'b'>)"],
  ['any', { kind: 'any' }, 'unknown'],
  ['list of any uses suffix form', { kind: 'list', min: 0, inner: { kind: 'any' } }, 'unknown[]'],
  // `opaque` is the uninterpreted slot; at the TS level identical to `any` → `unknown`.
  ['opaque', { kind: 'opaque' }, 'unknown'],
  ['list of opaque uses suffix form', { kind: 'list', min: 0, inner: { kind: 'opaque' } }, 'unknown[]'],
  ['def-reference unbound', { kind: 'def-reference' }, 'DefRef<string>'],
  ['def-reference single bound', { kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool' } }, "DefRef<'mcp.tool'>"],
  ['def-reference union bound', { kind: 'def-reference', bound: { kind: 'compound', op: 'union', branches: ['a', 'b'] } }, "DefRef<'a' | 'b'>"],
  ['def-reference intersection bound', { kind: 'def-reference', bound: { kind: 'compound', op: 'intersection', branches: ['a', 'b'] } }, "DefRef<'a' & 'b'>"],
  ['list of def-reference uses suffix form', { kind: 'list', min: 0, inner: { kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool' } } }, "DefRef<'mcp.tool'>[]"],
  ['tuple of primitives', { kind: 'tuple', elements: [{ kind: 'primitive', name: 'Number' }, { kind: 'primitive', name: 'Number' }] }, '[number, number]'],
  ['tuple mixed element shapes', { kind: 'tuple', elements: [{ kind: 'primitive', name: 'String' }, ref('point'), { kind: 'record', name: 'point' }] }, "[string, Ref<'point'>, Point]"],
  ['tuple of tuples', { kind: 'tuple', elements: [{ kind: 'tuple', elements: [{ kind: 'primitive', name: 'Number' }, { kind: 'primitive', name: 'Number' }] }, { kind: 'tuple', elements: [{ kind: 'primitive', name: 'Number' }, { kind: 'primitive', name: 'Number' }] }] }, '[[number, number], [number, number]]'],
  ['list of tuple uses suffix form (tuple is simple)', { kind: 'list', min: 0, inner: { kind: 'tuple', elements: [{ kind: 'primitive', name: 'Number' }, { kind: 'primitive', name: 'Number' }] } }, '[number, number][]'],
  ['pinned reference is its inner type', { kind: 'pinned', inner: ref('decision') }, "Ref<'decision'>"],
  ['pinned file is its inner type', { kind: 'pinned', inner: ref('file') }, "Ref<'file'>"],
  ['list of pinned reference follows inner (simple → suffix)', { kind: 'list', min: 0, inner: { kind: 'pinned', inner: ref('decision') } }, "Ref<'decision'>[]"],
  ['list of pinned compound-reference follows inner (not simple → Array<>)', { kind: 'list', min: 0, inner: { kind: 'pinned', inner: { kind: 'compound-reference', mode: 'inline-or-ref', op: 'union', branches: ['a', 'b'] } } }, "Array<A | B | Ref<'a' | 'b'>>"],
  // `::repo` is stripped inside the brand literal, matching the identifier path. See
  // [[message - 260708000013 - ref and def-ref brand literals keep the repo qualifier::au-host]].
  ['qualified reference strips the brand', ref('projection::au-host-sdk'), "Ref<'projection'>"],
  ['qualified inline-or-reference strips both arms', { kind: 'inline-or-reference', name: 'projection::au-host-sdk' }, "Projection | Ref<'projection'>"],
  ['qualified compound-reference ref/union strips each branch', { kind: 'compound-reference', mode: 'ref', op: 'union', branches: ['a::r1', 'b::r2'] }, "Ref<'a' | 'b'>"],
  ['qualified def-reference single bound strips the brand', { kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool::harness' } }, "DefRef<'mcp.tool'>"],
]

describe('shapeToTs', () => {
  test.each(cases)('%s', (_label, shape, expected) => {
    expect(shapeToTs(shape, nameOf)).toBe(expected)
  })

  test('nested list of inline-or-reference', () => {
    const shape: WireShape = { kind: 'list', min: 1, inner: { kind: 'inline-or-reference', name: 'assumption' } }
    expect(shapeToTs(shape, nameOf)).toBe("[Assumption | Ref<'assumption'>, ...Array<Assumption | Ref<'assumption'>>]")
  })
})
