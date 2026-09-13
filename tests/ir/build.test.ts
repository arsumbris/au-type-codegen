import { describe, expect, test } from 'vitest'
import { CodegenError } from '../../src/errors.ts'
import { buildIR } from '../../src/ir/build.ts'
import type { WireTypeDef } from '../../src/input/wire.ts'
import { fixtureGraph } from '../fixtures/type-graphs.ts'

describe('buildIR', () => {
  const ir = buildIR(fixtureGraph)

  test('indexes every type by canonical name', () => {
    expect(ir.types).toHaveLength(fixtureGraph.length)
    expect(ir.byName.get('decision.decided')?.name).toBe('decision.decided')
    expect(ir.byName.get('note')?.name).toBe('note')
  })

  test('carries parents from the type claim', () => {
    expect(ir.byName.get('decision')?.parents).toEqual(['note'])
    expect(ir.byName.get('person')?.parents).toEqual(['entity'])
    expect(ir.byName.get('note')?.parents).toEqual([])
  })

  test('classifies a sealed parent and its leaves', () => {
    const decision = ir.byName.get('decision')!
    expect(decision.sealed).toEqual(['decision.pending', 'decision.decided'])
    expect(decision.sealedParent).toBeNull()
  })

  test('classifies leaves with their sealed parent', () => {
    expect(ir.byName.get('decision.pending')?.sealedParent).toBe('decision')
    expect(ir.byName.get('decision.decided')?.sealedParent).toBe('decision')
    expect(ir.byName.get('decision.decided')?.sealed).toBeNull()
  })

  test('a plain type is neither sealed nor a leaf', () => {
    const entity = ir.byName.get('entity')!
    expect(entity.sealed).toBeNull()
    expect(entity.sealedParent).toBeNull()
  })

  test('keeps own fields with their parsed shape and required flag', () => {
    const decision = ir.byName.get('decision')!
    const assumptions = decision.fields.find((f) => f.name === 'assumptions')!
    expect(assumptions.required).toBe(false)
    expect(assumptions.shape).toEqual({
      kind: 'list',
      min: 1,
      inner: { kind: 'inline-or-reference', name: 'assumption' },
    })

    const rationale = decision.fields.find((f) => f.name === 'rationale')!
    expect(rationale.required).toBe(true)
    expect(rationale.shape).toEqual({ kind: 'primitive', name: 'String' })
  })

  test('surfaces meta blocks on the model, defaulting to empty', () => {
    // no meta_blocks on any fixture def → empty list, never undefined.
    expect(ir.byName.get('note')?.meta).toEqual([])

    const withMeta: WireTypeDef[] = [
      {
        name: 'ui-intent-highlight',
        parents: ['intent'],
        sealed: null,
        fields: [],
        meta_blocks: [
          {
            type_name: 'intent-routing-meta',
            body: [{ name: 'kind', value: 'broadcast' }],
            source: { file: '', span: { start: 0, end: 0 } },
          },
        ],
      },
      { name: 'intent', parents: [], sealed: null, fields: [], meta_blocks: null },
    ]
    const built = buildIR(withMeta)
    expect(built.byName.get('ui-intent-highlight')?.meta).toEqual([
      { typeName: 'intent-routing-meta', fields: [{ name: 'kind', value: 'broadcast' }] },
    ])
    // `null` meta_blocks normalizes to an empty list.
    expect(built.byName.get('intent')?.meta).toEqual([])
  })

  test('rejects a duplicate type-def name', () => {
    const dup: WireTypeDef[] = [
      { name: 'note', parents: [], sealed: null, fields: [] },
      { name: 'note', parents: [], sealed: null, fields: [] },
    ]
    expect(() => buildIR(dup)).toThrow(CodegenError)
  })
})
