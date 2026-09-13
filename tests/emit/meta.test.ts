import { describe, expect, test, vi } from 'vitest'
import { emitTypeScript } from '../../src/emit/ts/emit.ts'
import { buildIR } from '../../src/ir/build.ts'
import type { WireTypeDef } from '../../src/input/wire.ts'

const loc = { file: '', span: { start: 0, end: 0 } }

/** The intent vocabulary au-host drives this feature from. */
const intentGraph: WireTypeDef[] = [
  { name: 'intent', parents: [], sealed: null, fields: [] },
  {
    name: 'intent-routing-meta',
    parents: [],
    sealed: null,
    fields: [
      { name: 'kind', shape: '[routed, broadcast]', shape_ast: { kind: 'enum', members: ['routed', 'broadcast'] }, required: true },
      { name: 'dispatch', shape: '[ambient, firer-relative]', shape_ast: { kind: 'enum', members: ['ambient', 'firer-relative'] }, required: false },
    ],
  },
  {
    name: 'open-intent',
    parents: ['intent'],
    sealed: null,
    fields: [{ name: 'target', shape: 'String', shape_ast: { kind: 'primitive', name: 'String' }, required: true }],
    meta_blocks: [
      { type_name: 'intent-routing-meta', body: [{ name: 'kind', value: 'routed' }, { name: 'dispatch', value: 'ambient' }], source: loc },
    ],
  },
  {
    name: 'ui-intent-highlight',
    parents: ['intent'],
    sealed: null,
    fields: [{ name: 'mode', shape: '[show-if-visible, reveal-if-exists]', shape_ast: { kind: 'enum', members: ['show-if-visible', 'reveal-if-exists'] }, required: true }],
    meta_blocks: [{ type_name: 'intent-routing-meta', body: [{ name: 'kind', value: 'broadcast' }], source: loc }],
  },
]

const emit = (config = {}) => emitTypeScript(buildIR(intentGraph), config)

describe('meta value-mode constant emission', () => {
  const withConst = emit({ meta: new Map([['intent-routing-meta', { mode: 'const' as const }]]), metaSatisfies: false })

  test('emits a per-host constant from the meta block values', () => {
    expect(withConst).toContain("export const UI_INTENT_HIGHLIGHT_INTENT_ROUTING = { kind: 'broadcast' } as const")
    expect(withConst).toContain("export const OPEN_INTENT_INTENT_ROUTING = { kind: 'routed', dispatch: 'ambient' } as const")
  })

  test('the suffix override yields au-host\'s exact standin names', () => {
    const out = emit({ meta: new Map([['intent-routing-meta', { mode: 'const' as const, suffix: 'ROUTING' }]]) })
    expect(out).toContain("export const UI_INTENT_HIGHLIGHT_ROUTING = { kind: 'broadcast' } as const")
    expect(out).toContain("export const OPEN_INTENT_ROUTING = { kind: 'routed', dispatch: 'ambient' } as const")
  })

  test('an absent optional field is absent in the literal, no `undefined`', () => {
    // ui-intent-highlight is broadcast, so `dispatch` is not in the block.
    expect(withConst).toContain("UI_INTENT_HIGHLIGHT_INTENT_ROUTING = { kind: 'broadcast' }")
    expect(withConst).not.toContain('dispatch: undefined')
  })

  test('satisfies appends Omit<MetaInterface, \'type\'> when opted in', () => {
    const out = emit({ meta: new Map([['intent-routing-meta', { mode: 'const' as const, suffix: 'ROUTING' }]]), metaSatisfies: true })
    expect(out).toContain("export const UI_INTENT_HIGHLIGHT_ROUTING = { kind: 'broadcast' } as const satisfies Omit<IntentRoutingMeta, 'type'>")
  })

  test('no --meta flag emits no constants, output unchanged', () => {
    const plain = emit()
    expect(plain).not.toContain('export const')
  })

  test('a matchless allowlist entry warns', () => {
    const onWarn = vi.fn()
    emit({ meta: new Map([['no-such-meta', { mode: 'const' as const }]]), onWarn })
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('no-such-meta'))
  })

  test('the meta constant does not pollute the instance interfaces', () => {
    // meta stays out of the host def's interface (load-bearing for au-host).
    expect(withConst).toContain('export interface UiIntentHighlight')
    expect(withConst).not.toMatch(/interface UiIntentHighlight[^}]*kind/)
  })
})

// A def-ref-list meta type: `handles: type<intent>*[]`.
const handlesMeta: WireTypeDef = {
  name: 'handles-meta',
  parents: [],
  sealed: null,
  fields: [{ name: 'handles', shape: 'type<intent>*[]', shape_ast: { kind: 'list', min: 0, inner: { kind: 'def-reference', bound: { kind: 'single', name: 'intent' } } }, required: true }],
}

describe('meta type-mode: payload map (family-owning package)', () => {
  // The intent package owns the intent family + handles-meta, so it emits IntentPayloads.
  const intentPkg: WireTypeDef[] = [...intentGraph, handlesMeta]
  const out = emitTypeScript(buildIR(intentPkg), { meta: new Map([['handles-meta', { mode: 'type' as const, suffix: 'HandledIntents' }]]) })

  test('emits a payload map keyed by the intent `type` literal', () => {
    expect(out).toContain("export interface IntentPayloads {\n  'open-intent': OpenIntent\n  'ui-intent-highlight': UiIntentHighlight\n}")
  })

  test('excludes the open base (no literal `type`)', () => {
    expect(out).not.toMatch(/IntentPayloads \{[^}]*'intent':/)
  })

  test('emits no union when no host carries the meta block', () => {
    expect(out).not.toContain('HandledIntents =')
  })
})

describe('meta type-mode: per-host union (host-owning package)', () => {
  // A projection package: owns `editor-pane` (with a handles block). `handles-meta`
  // is owned by `intent`, so in this scoped read it is NOT a def here — only the
  // host def carrying the block is. The union resolves from the block values.
  const projectionPkg: WireTypeDef[] = [
    {
      name: 'editor-pane',
      parents: [],
      sealed: null,
      fields: [],
      meta_blocks: [{ type_name: 'handles-meta', body: [{ name: 'handles', value: ['[[open-intent]]', '[[ui-intent-highlight]]'] }], source: loc }],
    },
  ]
  const emitProj = (suffix?: string) =>
    emitTypeScript(buildIR(projectionPkg), { moduleMap: new Map([['intent', '@arsumbris/intent']]), meta: new Map([['handles-meta', { mode: 'type' as const, suffix }]]) })

  test('emits a per-host union of resolved `type` literals, keyed by host def', () => {
    expect(emitProj('HandledIntents')).toContain("export type EditorPaneHandledIntents = 'open-intent' | 'ui-intent-highlight'")
  })

  test('the default suffix derives from the meta stem', () => {
    expect(emitProj()).toContain('export type EditorPaneHandles =')
  })

  test('emits no payload map when the family is not owned here', () => {
    expect(emitProj('HandledIntents')).not.toContain('Payloads')
  })

  test('resolves wikilink fragments and `::repo` to the bare name', () => {
    const pkg: WireTypeDef[] = [
      { name: 'editor-pane', parents: [], sealed: null, fields: [], meta_blocks: [{ type_name: 'handles-meta', body: [{ name: 'handles', value: ['[[open-intent::intent]]', '[[ui-intent-highlight#foo]]'] }], source: loc }] },
    ]
    const out = emitTypeScript(buildIR(pkg), { moduleMap: new Map([['intent', '@arsumbris/intent']]), meta: new Map([['handles-meta', { mode: 'type' as const, suffix: 'HandledIntents' }]]) })
    expect(out).toContain("export type EditorPaneHandledIntents = 'open-intent' | 'ui-intent-highlight'")
  })

  test('a matchless type entry warns', () => {
    const onWarn = vi.fn()
    emitTypeScript(buildIR(projectionPkg), { moduleMap: new Map([['intent', '@arsumbris/intent']]), meta: new Map([['no-such-meta', { mode: 'type' as const }]]), onWarn })
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('no-such-meta'))
  })
})

describe('meta constant collisions', () => {
  test('two hosts folding to one constant name throw', () => {
    const collide: WireTypeDef[] = [
      { name: 'foo-bar', parents: [], sealed: null, fields: [], meta_blocks: [{ type_name: 'r-meta', body: [{ name: 'a', value: 1 }], source: loc }] },
      { name: 'foo.bar', parents: [], sealed: null, fields: [], meta_blocks: [{ type_name: 'r-meta', body: [{ name: 'a', value: 2 }], source: loc }] },
    ]
    expect(() => emitTypeScript(buildIR(collide), { meta: new Map([['r-meta', { mode: 'const' }]]) })).toThrow(/both map to/)
  })
})
