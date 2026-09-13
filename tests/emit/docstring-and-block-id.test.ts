import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import { docstringGraph, fixtureGraph } from '../fixtures/type-graphs.ts'

// The universal `^:` block-id slot every generated interface now carries.
const BLOCK_ID = "  /** The record's engine-assigned `^:` block id, present once addressed. Advisory, never validated. */\n  '^'?: string"

function typechecks(source: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'codegen-slots-'))
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

describe('`#:` docstrings surface as JSDoc', () => {
  const out = emitTypeScript(buildIR(docstringGraph))

  test('a type-level doc renders as an inline JSDoc above the interface', () => {
    expect(out).toContain('/** A 3D vector. */\nexport interface Vector {')
  })

  test('a single-line field doc renders as an inline JSDoc above the field', () => {
    expect(out).toContain('  /** The x component. */\n  x: number')
  })

  test('a multi-line field doc renders as a starred JSDoc block', () => {
    expect(out).toContain('  /**\n   * The z component.\n   * Up is positive.\n   */\n  z: number')
  })

  test('an undocumented field carries no JSDoc', () => {
    // `y` sits between documented `x` and `z`, with no comment of its own.
    expect(out).toContain('  x: number\n  y: number\n  /**')
  })

  test('a sealed def doc rides the union alias, not the Base interface', () => {
    expect(out).toContain('/** A drawable shape. */\nexport type Shape = ShapeCircle')
    // The Base carries no def doc of its own.
    expect(out).not.toContain('/** A drawable shape. */\nexport interface ShapeBase')
  })

  test('a doc containing `*/` is escaped so it cannot close the JSDoc block early', () => {
    // the raw `*/` (in `"**/*.ts"`) is escaped to `*\/`, which renders as `*/` but is not a terminator.
    expect(out).toContain('/** a glob, e.g. "**\\/*.ts". */\n  pattern?: string')
    expect(out).not.toContain('/** a glob, e.g. "**/*.ts". */') // the unescaped form would break the parse
  })

  test('the documented output typechecks under tsc --strict', () => {
    expect(typechecks(out)).toBe(true)
  })
})

describe('the universal `^:` block-id slot', () => {
  const out = emitTypeScript(buildIR(fixtureGraph))

  test('every generated interface carries an optional `^` block-id slot', () => {
    // Spelled with the faithful caret key, never a friendly `id` that could
    // collide with a real declared field.
    expect(out).toContain("  '^'?: string")
    expect(out).not.toContain('  id?: string')
    // On an open base, right after the `type` discriminant.
    expect(out).toContain(`export interface Note {\n  type?: string\n${BLOCK_ID}\n  description: string\n}`)
    // On a sealed leaf, after its required literal.
    expect(out).toContain(`export interface DecisionPending extends Omit<DecisionBase, 'type'> {\n  type: 'decision.pending'\n${BLOCK_ID}\n`)
  })

  test('the caret key survives the type-only Omit on extends, so children inherit it too', () => {
    // The block-id slot rides through the extension chain untouched, and the
    // output still typechecks with the quoted key.
    expect(typechecks(out)).toBe(true)
  })
})
