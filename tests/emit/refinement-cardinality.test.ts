import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, test } from 'vitest'
import { emitJsonSchema } from '../../src/emit/json-schema/emit.ts'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import { refinementGraph } from '../fixtures/type-graphs.ts'

// Schema 27: value refinement (`Base{predicate}`) and range cardinality end to
// end, through both emitters.

function typechecks(source: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'codegen-refine-'))
  const file = join(dir, 'generated.ts')
  writeFileSync(file, source)
  try {
    execFileSync('node_modules/.bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--ignoreConfig', '--target', 'ES2022', file], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

describe('TS emit — refinement and cardinality', () => {
  const out = emitTypeScript(buildIR(refinementGraph))

  test('a refined field narrows to its base type', () => {
    expect(out).toContain('count: number')
    expect(out).toContain('slug?: string')
  })

  test("a refinement surfaces as the field's JSDoc, since the TS type cannot carry it", () => {
    expect(out).toContain('/** Refined Number, >= 0, integer */\n  count: number')
    expect(out).toContain('/** Refined String, pattern /^[a-z0-9-]+$/ */\n  slug?: string')
  })

  test('a fixed-length list is a tuple; a bounded range uses optional slots', () => {
    expect(out).toContain('rgb: [number, number, number]')
    expect(out).toContain('tags?: [string, string?, string?, string?]')
  })

  test('the generated output typechecks under tsc --strict', () => {
    expect(typechecks(out)).toBe(true)
  })
})

describe('JSON Schema emit — refinement and cardinality', () => {
  const schema = emitJsonSchema(buildIR(refinementGraph), 'metric')
  const props = schema.properties ?? {}

  test('a Number refinement maps to integer + minimum', () => {
    expect(props['count']).toEqual({ type: 'integer', minimum: 0 })
  })

  test('a String refinement maps to a pattern', () => {
    expect(props['slug']).toEqual({ type: 'string', pattern: '^[a-z0-9-]+$' })
  })

  test('cardinality maps to minItems / maxItems', () => {
    expect(props['rgb']).toEqual({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } })
    expect(props['tags']).toEqual({ type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } })
  })

  test('the whole document is valid Draft 2020-12 and enforces the constraints', () => {
    const validate = new Ajv2020({ strict: false }).compile(schema)
    expect(validate({ count: 3, rgb: [1, 2, 3] })).toBe(true)
    expect(validate({ count: 3.5, rgb: [1, 2, 3] })).toBe(false) // not an integer
    expect(validate({ count: -1, rgb: [1, 2, 3] })).toBe(false) // below minimum
    expect(validate({ count: 3, rgb: [1, 2] })).toBe(false) // too few items
    expect(validate({ count: 3, rgb: [1, 2, 3], slug: 'AB' })).toBe(false) // pattern mismatch
    expect(validate({ count: 3, rgb: [1, 2, 3], tags: ['a', 'b', 'c', 'd', 'e'] })).toBe(false) // too many items
  })
})
