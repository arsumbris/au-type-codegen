import { describe, expect, test } from 'vitest'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import { bentoSlice, metaMarkerSlice, xrConsumerSlice } from '../fixtures/type-graphs.ts'

// The universal `^:` block-id slot every generated interface now carries.
const BLOCK_ID = "  /** The record's engine-assigned `^:` block id, present once addressed. Advisory, never validated. */\n  '^'?: string"

const hostMap = new Map([['host', '@arsumbris/au-host-sdk']])
const emitBento = (extra = {}) => emitTypeScript(buildIR(bentoSlice), { repo: 'bento', moduleMap: hostMap, ...extra })

describe('per-package emit — generate owned, import borrowed', () => {
  const out = emitBento()

  test('stamps the per-package header with the repo', () => {
    expect(out).toContain('// Source: au-engine type-defs, repo `bento`.')
  })

  test('imports a borrowed type referenced by identifier from its owner module', () => {
    expect(out).toContain("import type { ProjectionConfig } from '@arsumbris/au-host-sdk'")
  })

  test('never re-declares a borrowed type', () => {
    expect(out).not.toContain('export interface ProjectionConfig')
    expect(out).not.toContain('export interface Projection ')
  })

  test('a borrow referenced only via Ref<> is not imported', () => {
    // `projection` appears only as `Ref<'projection'>` (a string brand), so it needs no import.
    const imports = out.split('\n').filter((l) => l.startsWith('import '))
    expect(imports).toEqual(["import type { ProjectionConfig } from '@arsumbris/au-host-sdk'"])
    expect(out).toContain("projection?: Ref<'projection'>")
  })

  test('owned types are generated, extending the imported borrow', () => {
    expect(out).toContain("export interface BentoLayout extends Omit<ProjectionConfig, 'type'> {")
    expect(out).toContain("  root: Ref<'bento-node'>")
    expect(out).toContain("export interface BentoNodeLeaf extends Omit<BentoNodeBase, 'type'> {")
    expect(out).toContain('  config?: ProjectionConfig')
  })

  test('ref/sum/list field shapes render as proper TS', () => {
    expect(out).toContain("  direction: 'row' | 'column'")
    expect(out).toContain('  ratio: number')
    expect(out).toContain("  children: Ref<'bento-node'>[]")
    expect(out).toContain("  tabs: Ref<'bento-node.leaf'>[]")
  })

  test('sealed family emits a Base interface plus a discriminated union', () => {
    expect(out).toContain(`export interface BentoNodeBase {\n${BLOCK_ID}\n}`)
    expect(out).toContain('export type BentoNode = BentoNodeBranch | BentoNodeLeaf | BentoNodeTabgroup')
    expect(out).toContain("  type: 'bento-node.branch'")
  })
})

describe('per-package emit — unresolvable borrow', () => {
  test('errors by default, naming the type and its owner', () => {
    expect(() => emitTypeScript(buildIR(bentoSlice), { repo: 'bento', moduleMap: new Map() })).toThrow(
      /borrowed type\(s\) have no module mapping: 'projection-config::host' \(owner 'host'\)/s,
    )
  })
})

describe('per-package emit — cross-repo `::repo`-qualified reference', () => {
  const xrMap = new Map([['xr-base', '@arsumbris/xr-base']])
  const emitXr = (extra = {}) => emitTypeScript(buildIR(xrConsumerSlice), { repo: 'xr-consumer', moduleMap: xrMap, ...extra })

  test('a qualified parent imports the bare name from its owner module', () => {
    const out = emitXr()
    expect(out).toContain("import type { Widget } from '@arsumbris/xr-base'")
  })

  test('the extends site uses the bare name, never the `::repo`-qualified identifier', () => {
    const out = emitXr()
    expect(out).toContain("export interface Gadget extends Omit<Widget, 'type'> {")
    expect(out).not.toContain('::')
    expect(out).not.toContain('xrBase')
  })

  test('the owned leaf still carries its own literal discriminant', () => {
    expect(emitXr()).toContain("  type: 'gadget'")
    expect(emitXr()).toContain('  extra?: string')
  })

  test('a qualified ref with no module mapping errors, naming the type and its owner', () => {
    expect(() => emitTypeScript(buildIR(xrConsumerSlice), { repo: 'xr-consumer', moduleMap: new Map() })).toThrow(
      /borrowed type\(s\) have no module mapping: 'widget::xr-base' \(owner 'xr-base'\)/s,
    )
  })
})

describe('per-package emit — the universal engine meta marker', () => {
  // Schema 18's `au.engine.meta::au-engine` is a fieldless nominal marker, not a
  // borrow: no module, no import, no `extends`. It must not hard-error, and the
  // output must match the pre-marker shape.
  const emitMarked = () => emitTypeScript(buildIR(metaMarkerSlice), { repo: 'intent', moduleMap: new Map() })

  test('does not require a module for the au-engine marker owner', () => {
    expect(() => emitMarked()).not.toThrow()
  })

  test('emits no import for the marker', () => {
    const imports = emitMarked().split('\n').filter((l) => l.startsWith('import '))
    expect(imports).toEqual([])
  })

  test('never extends or re-declares the marker', () => {
    const out = emitMarked()
    expect(out).not.toContain('au.engine.meta')
    expect(out).not.toContain('AuEngineMeta')
    expect(out).not.toContain('::')
  })

  test('a marker-only parent becomes a root: `type: string`, no extends', () => {
    const out = emitMarked()
    expect(out).toContain(`export interface IntentSummary {\n  type?: string\n${BLOCK_ID}\n  label: string\n}`)
  })

  test('the strip is surgical: a real supertype alongside the marker still extends', () => {
    const out = emitMarked()
    expect(out).toContain("export interface IntentDetail extends Omit<Intent, 'type'> {")
    expect(out).toContain("  type: 'intent.detail'")
  })

  test('the bare (unqualified) marker form is stripped too', () => {
    const out = emitMarked()
    expect(out).toContain(`export interface IntentBare {\n  type?: string\n${BLOCK_ID}\n  note?: string\n}`)
  })
})
