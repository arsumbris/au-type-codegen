import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildIR } from '../../src/ir/build.ts'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import type { WireTypeDef } from '../../src/input/wire.ts'
import { fixtureGraph, shapeKindsGraph } from '../fixtures/type-graphs.ts'

// The universal `^:` block-id slot every generated interface now carries.
const BLOCK_ID = "  /** The record's engine-assigned `^:` block id, present once addressed. Advisory, never validated. */\n  '^'?: string"

const out = emitTypeScript(buildIR(fixtureGraph))

describe('emitTypeScript — decision family', () => {
  test('emits the Ref brand helper once', () => {
    expect(out).toContain('export type Ref<T extends string> = string & { readonly __ref: T }')
  })

  test('an open base carries an optional string discriminant plus its primitive field', () => {
    // Note is extended by `decision` (non-sealed edge), so it is an open base.
    expect(out).toContain(`export interface Note {\n  type?: string\n${BLOCK_ID}\n  description: string\n}`)
  })

  test('subtype extends its parent', () => {
    expect(out).toContain("export interface Person extends Omit<Entity, 'type'> {")
    expect(out).toContain('  manager?: Ref<\'person\'>')
  })

  test('sealed parent becomes a Base interface plus a union', () => {
    expect(out).toContain("export interface DecisionBase extends Omit<Note, 'type'> {")
    expect(out).toContain('export type Decision = DecisionPending | DecisionDecided')
  })

  test('a leaf extends the parent Base, not the union', () => {
    expect(out).toContain("export interface DecisionPending extends Omit<DecisionBase, 'type'> {")
    expect(out).toContain("export interface DecisionDecided extends Omit<DecisionBase, 'type'> {")
  })

  test('sealed leaves carry a type discriminant literal as the first property', () => {
    expect(out).toContain(`export interface DecisionPending extends Omit<DecisionBase, 'type'> {\n  type: 'decision.pending'\n${BLOCK_ID}\n  opened_at: string\n}`)
    expect(out).toContain(`  type: 'decision.decided'\n${BLOCK_ID}\n  status: 'made' | 'superseded'`)
  })

  test('a sealed Base carries no own discriminant; a standalone root carries `type: string`', () => {
    // DecisionBase is a sealed parent — its union narrows, so it declares no `type`.
    expect(out).toContain(`export interface DecisionBase extends Omit<Note, 'type'> {\n${BLOCK_ID}\n  rationale: string`)
    expect(out).not.toContain("export interface DecisionBase extends Omit<Note, 'type'> {\n  type:")
    // `assumption` is a non-sealed root — an open base, extension-ready, so `type?: string`.
    expect(out).toContain(`export interface Assumption {\n  type?: string\n${BLOCK_ID}\n  description: string`)
  })

  test('enum, reference, and non-empty inline-or-reference fields', () => {
    expect(out).toContain("  status: 'made' | 'superseded'")
    expect(out).toContain("  decided_by?: Ref<'person'>")
    expect(out).toContain("  assumptions?: [Assumption | Ref<'assumption'>, ...Array<Assumption | Ref<'assumption'>>]")
    expect(out).toContain("  notes?: [Ref<'file'>, ...Array<Ref<'file'>>]")
  })

  test('the generated module typechecks under tsc --strict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-'))
    const file = join(dir, 'generated.ts')
    writeFileSync(file, out)
    expect(() =>
      execFileSync('node_modules/.bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--ignoreConfig', '--target', 'ES2022', file], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })
})

describe('emitTypeScript — any / def-reference / pinned shapes', () => {
  const shapeOut = emitTypeScript(buildIR(shapeKindsGraph))

  test('emits the DefRef brand helper, distinct from Ref', () => {
    expect(shapeOut).toContain('export type DefRef<T extends string> = string & { readonly __defRef: T }')
  })

  test('maps any → unknown, def-reference → DefRef, pinned → its inner Ref', () => {
    expect(shapeOut).toContain('  blob: unknown')
    expect(shapeOut).toContain("  tool?: DefRef<'mcp.tool'>")
    expect(shapeOut).toContain('  anyDef?: DefRef<string>')
    expect(shapeOut).toContain("  pinnedRef?: Ref<'decision'>")
  })

  test('the generated module typechecks under tsc --strict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-shapes-'))
    const file = join(dir, 'generated.ts')
    writeFileSync(file, shapeOut)
    expect(() =>
      execFileSync('node_modules/.bin/tsc', ['--noEmit', '--strict', '--skipLibCheck', '--ignoreConfig', '--target', 'ES2022', file], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })
})

describe('emitTypeScript — errors', () => {
  test('a TS-name collision is reported', () => {
    const colliding: WireTypeDef[] = [
      { name: 'foo-bar', parents: [], sealed: null, fields: [] },
      { name: 'foo_bar', parents: [], sealed: null, fields: [] },
    ]
    expect(() => emitTypeScript(buildIR(colliding))).toThrow(/both map to TS identifier 'FooBar'/)
  })

  test('a null shape_ast surfaces as unknown with the source shape', () => {
    const broken: WireTypeDef[] = [
      { name: 'broken', parents: [], sealed: null, fields: [{ name: 'bad', shape: 'String**', shape_ast: null, required: true }] },
    ]
    expect(emitTypeScript(buildIR(broken))).toContain('  bad: unknown /* unparsed: String** */')
  })
})
