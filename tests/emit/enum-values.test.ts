import { describe, expect, test } from 'vitest'
import { CodegenError } from '../../src/errors.ts'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import type { WireTypeDef } from '../../src/input/wire.ts'
import { brandGraph, fixtureGraph } from '../fixtures/type-graphs.ts'

// A runtime enum value array beside the union type: a NAMED enum brand always
// emits `<Brand>Values`; a top-level FIELD enum emits `<Host><Field>Values` only
// under `enumFieldValues`. A faithful `[...] as const`, PascalCase, top-level only.
// See [[decision - 2609092043 - emit runtime enum value arrays, brands always field enums opt-in]].

describe('emitTypeScript — enum value arrays', () => {
  test('a NAMED enum brand always emits a value array, even without the field-enum opt-in', () => {
    const out = emitTypeScript(buildIR(brandGraph))
    expect(out).toContain("export const IconRoleValues = ['save', 'delete', 'open'] as const")
    // Beside the union type it mirrors.
    expect(out).toMatch(/export type IconRole = 'save' \| 'delete' \| 'open'/)
  })

  test('a non-enum brand (scalar / tuple / union) emits no value array', () => {
    const out = emitTypeScript(buildIR(brandGraph))
    expect(out).not.toContain('MeterValues')
    expect(out).not.toContain('RectValues')
    expect(out).not.toContain('EvidenceKindValues')
  })

  test('a FIELD enum emits NO value array by default', () => {
    const out = emitTypeScript(buildIR(fixtureGraph))
    expect(out).not.toContain('AssumptionConfidenceValues')
    expect(out).not.toContain('QualityGateValues')
    expect(out).not.toContain('DecisionDecidedStatusValues')
  })

  test('a FIELD enum emits a value array under enumFieldValues, PascalCase host+field', () => {
    const out = emitTypeScript(buildIR(fixtureGraph), { enumFieldValues: true })
    expect(out).toContain("export const AssumptionConfidenceValues = ['low', 'medium', 'high'] as const")
    expect(out).toContain("export const QualityGateValues = ['stub', 'slop', 'polish', 'shared'] as const")
    expect(out).toContain("export const DecisionDecidedStatusValues = ['made', 'superseded'] as const")
  })

  test('the field-enum opt-in does not gate brand enums — those stay always-on', () => {
    const out = emitTypeScript(buildIR(brandGraph), { enumFieldValues: true })
    expect(out).toContain('export const IconRoleValues =')
  })

  test('a NESTED enum (a list-of-enum field) emits no value array — top-level only', () => {
    const listOfEnum: WireTypeDef[] = [
      {
        name: 'palette',
        parents: [],
        sealed: null,
        // tones: "[warm, cool][]" — an enum inside a list, not a top-level enum.
        fields: [{ name: 'tones', shape: '[warm, cool][]', shape_ast: { kind: 'list', min: 0, inner: { kind: 'enum', members: ['warm', 'cool'] } }, required: false }],
      },
    ]
    const out = emitTypeScript(buildIR(listOfEnum), { enumFieldValues: true })
    expect(out).not.toContain('PaletteTonesValues')
  })

  test('an underscore field name PascalCases across the boundary', () => {
    const underscored: WireTypeDef[] = [
      {
        name: 'task',
        parents: [],
        sealed: null,
        fields: [{ name: 'sort_order', shape: '[asc, desc]', shape_ast: { kind: 'enum', members: ['asc', 'desc'] }, required: true }],
      },
    ]
    const out = emitTypeScript(buildIR(underscored), { enumFieldValues: true })
    expect(out).toContain("export const TaskSortOrderValues = ['asc', 'desc'] as const")
  })

  test('two enum-value consts colliding on one identifier throw, like the meta guard', () => {
    // `a-b` field `c` and `a` field `b-c` both fold to `ABCValues`.
    const colliding: WireTypeDef[] = [
      { name: 'a-b', parents: [], sealed: null, fields: [{ name: 'c', shape: '[x]', shape_ast: { kind: 'enum', members: ['x'] }, required: true }] },
      { name: 'a', parents: [], sealed: null, fields: [{ name: 'b-c', shape: '[y]', shape_ast: { kind: 'enum', members: ['y'] }, required: true }] },
    ]
    expect(() => emitTypeScript(buildIR(colliding), { enumFieldValues: true })).toThrow(CodegenError)
  })
})
