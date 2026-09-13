import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import { canvasPkg, hostSdkKindBase, openMidTier, rangeSelection } from '../fixtures/type-graphs.ts'

// The universal `^:` block-id slot every generated interface now carries.
const BLOCK_ID = "  /** The record's engine-assigned `^:` block id, present once addressed. Advisory, never validated. */\n  '^'?: string"

function typechecks(source: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'codegen-disc-'))
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

describe('open-hierarchy type discriminant', () => {
  const out = emitTypeScript(buildIR(rangeSelection))

  test('an open base gets an OPTIONAL `type?: string`', () => {
    expect(out).toContain(`export interface Range {\n  type?: string\n${BLOCK_ID}\n}`)
    expect(out).toContain(`export interface Selection {\n  type?: string\n${BLOCK_ID}\n  range?: Range | Ref<'range'>\n}`)
  })

  test('an open leaf subtype gets its own required `type` literal as the first property', () => {
    expect(out).toContain(`export interface TextRange extends Omit<Range, 'type'> {\n  type: 'text-range'\n${BLOCK_ID}\n  from: number\n  to: number\n}`)
    expect(out).toContain(`export interface FileSelection extends Omit<Selection, 'type'> {\n  type: 'file-selection'\n${BLOCK_ID}\n  path: string\n}`)
  })

  test('the generated open hierarchy typechecks under tsc --strict (literals assignable to the base string)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-disc-'))
    const file = join(dir, 'generated.ts')
    writeFileSync(file, out)
    expect(() =>
      execFileSync('node_modules/.bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--ignoreConfig', '--target', 'ES2022', file], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  test('a mid-tier type (both extended and extending) gets `type?: string`, not a literal', () => {
    const mid = emitTypeScript(buildIR(openMidTier))
    // `a` is a base, `b` is mid-tier (extends a, extended by c) → both optional string; only the `c` leaf gets a required literal.
    expect(mid).toContain(`export interface A {\n  type?: string\n${BLOCK_ID}\n}`)
    expect(mid).toContain(`export interface B extends Omit<A, 'type'> {\n  type?: string\n${BLOCK_ID}\n  x: number\n}`)
    expect(mid).toContain(`export interface C extends Omit<B, 'type'> {\n  type: 'c'\n${BLOCK_ID}\n  y: number\n}`)
  })
})

describe('a subtype extends a kind base that carries a disjoint literal `type` (TS2430 repro)', () => {
  const moduleMap = new Map([['host-sdk', '@arsumbris/au-host-sdk']])

  // host-sdk's read: `container-projection` has no co-present subtype, so it is
  // emitted with a literal `type: 'container-projection'`.
  const hostOut = emitTypeScript(buildIR(hostSdkKindBase))
  // canvas's read: `Canvas` OWNS its interface and extends the BORROWED base.
  const canvasOut = emitTypeScript(buildIR(canvasPkg), { moduleMap })

  // The combined cross-package file: host-sdk's literal base plus canvas's
  // subtype. This is what `tsc` sees once canvas imports `ContainerProjection`.
  const combined = hostOut + '\n' + canvasOut.slice(canvasOut.indexOf('export interface Canvas'))

  test('the owned subtype omits the inherited `type` so its own literal wins', () => {
    expect(canvasOut).toContain(`export interface Canvas extends Omit<ContainerProjection, 'type'> {\n  type: 'canvas'\n${BLOCK_ID}\n  title: string\n}`)
  })

  test('host-sdk still emits the kind base (its literal `type` is harmless, never read bare)', () => {
    expect(hostOut).toContain("type: 'container-projection'")
  })

  test('the cross-package output typechecks under tsc --strict (no TS2430)', () => {
    expect(typechecks(combined)).toBe(true)
  })
})
