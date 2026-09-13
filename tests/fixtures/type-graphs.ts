// Fixture type graphs, hand-written WireTypeDef[] with the same shape_ast the
// SDK will serve. Faithful to au-test-vault's type-defs.
//
// Covers: primitives, enums, T*/T&/file* references, [+] lists, sealed
// families, multi-segment names, parents, and optional fields. Slot-level
// union / intersection / compound-reference are exercised inline by the
// shape-mapping table test, not needed at the graph level here.

import type { WirePrimitiveName, WireShape, WireTypeDef } from '../../src/input/wire.ts'

// Tiny builders, so the fixtures read close to their source form.
const prim = (name: WirePrimitiveName): WireShape => ({ kind: 'primitive', name })
const enumOf = (...members: string[]): WireShape => ({ kind: 'enum', members })
const ref = (name: string): WireShape => ({ kind: 'reference', name })
const inlineOrRef = (name: string): WireShape => ({ kind: 'inline-or-reference', name })
const record = (name: string): WireShape => ({ kind: 'record', name })
const list = (inner: WireShape, min = 0, max?: number): WireShape => ({ kind: 'list', min, max, inner })

/** The canonical case: a sealed family three levels deep over `note`. */
export const decisionFamily: WireTypeDef[] = [
  {
    name: 'note',
    parents: [],
    sealed: null,
    fields: [{ name: 'description', shape: 'String', shape_ast: prim('String'), required: true }],
  },
  {
    name: 'decision',
    parents: ['note'],
    sealed: ['decision.pending', 'decision.decided'],
    fields: [
      { name: 'rationale', shape: 'String', shape_ast: prim('String'), required: true },
      // assumptions?: assumption&[+]
      { name: 'assumptions', shape: 'assumption&[+]', shape_ast: list(inlineOrRef('assumption'), 1), required: false },
      // notes?: file*[+]
      { name: 'notes', shape: 'file*[+]', shape_ast: list(ref('file'), 1), required: false },
    ],
  },
  {
    name: 'decision.pending',
    parents: ['decision'],
    sealed: null,
    fields: [{ name: 'opened_at', shape: 'Date', shape_ast: prim('Date'), required: true }],
  },
  {
    name: 'decision.decided',
    parents: ['decision'],
    sealed: null,
    fields: [
      { name: 'status', shape: '[made, superseded]', shape_ast: enumOf('made', 'superseded'), required: true },
      { name: 'decided_at', shape: 'Date', shape_ast: prim('Date'), required: true },
      { name: 'decided_by', shape: 'person*', shape_ast: ref('person'), required: false },
    ],
  },
]

/** Reference targets and extra shape coverage. */
export const supportingTypes: WireTypeDef[] = [
  {
    name: 'entity',
    parents: [],
    sealed: null,
    fields: [
      { name: 'name', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'description', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'active', shape: 'Boolean', shape_ast: prim('Boolean'), required: true },
      { name: 'aliases', shape: 'String[+]', shape_ast: list(prim('String'), 1), required: false },
    ],
  },
  {
    name: 'person',
    parents: ['entity'],
    sealed: null,
    fields: [
      { name: 'role', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'joined', shape: 'Date', shape_ast: prim('Date'), required: true },
      { name: 'manager', shape: 'person*', shape_ast: ref('person'), required: false },
    ],
  },
  {
    name: 'assumption',
    parents: [],
    sealed: null,
    fields: [
      { name: 'description', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'confidence', shape: '[low, medium, high]', shape_ast: enumOf('low', 'medium', 'high'), required: true },
      { name: 'supporting_evidence', shape: 'file*[+]', shape_ast: list(ref('file'), 1), required: false },
    ],
  },
  {
    name: 'quality',
    parents: [],
    sealed: null,
    fields: [{ name: 'gate', shape: '[stub, slop, polish, shared]', shape_ast: enumOf('stub', 'slop', 'polish', 'shared'), required: true }],
  },
]

/** The full fixture vault: the decision family plus its reference targets. */
export const fixtureGraph: WireTypeDef[] = [...decisionFamily, ...supportingTypes]

/** au-mcp's tool-input vocabulary: an open `toolInput` base with per-tool leaves. */
export const toolInputGraph: WireTypeDef[] = [
  { name: 'toolInput', parents: [], sealed: null, fields: [] },
  {
    name: 'toolInput.read_file',
    parents: ['toolInput'],
    sealed: null,
    fields: [
      { name: 'file_path', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'offset', shape: 'Number', shape_ast: prim('Number'), required: false },
      { name: 'limit', shape: 'Number', shape_ast: prim('Number'), required: false },
    ],
  },
  {
    name: 'toolInput.edit_file',
    parents: ['toolInput'],
    sealed: null,
    fields: [
      { name: 'file_path', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'old_string', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'new_string', shape: 'String', shape_ast: prim('String'), required: true },
      { name: 'replace_all', shape: 'Boolean', shape_ast: prim('Boolean'), required: false },
    ],
  },
]

/**
 * The au-host EQ4a slice from repo `bento`'s perspective, as a schema-17 scoped
 * read: `bento` OWNS the `bento-*` types only. Its dependency on `host` surfaces
 * as `::repo`-qualified references, NOT as vendored defs — `projection-config`
 * and `projection` are NOT in the read. `projection-config::host` is referenced
 * by identifier (a parent and a `record` field), so it must be imported;
 * `projection::host` is referenced only via `Ref<'projection'>`, so it needs no
 * import. Drives the import-borrowed tests.
 */
export const bentoSlice: WireTypeDef[] = [
  {
    name: 'bento-layout',
    parents: ['projection-config::host'],
    sealed: null,
    fields: [{ name: 'root', shape: 'bento-node&', shape_ast: ref('bento-node'), required: true }],
  },
  { name: 'bento-node', parents: [], sealed: ['bento-node.branch', 'bento-node.leaf', 'bento-node.tabgroup'], fields: [] },
  {
    name: 'bento-node.branch',
    parents: ['bento-node'],
    sealed: null,
    fields: [
      { name: 'direction', shape: '[row, column]', shape_ast: enumOf('row', 'column'), required: true },
      { name: 'ratio', shape: 'Number', shape_ast: prim('Number'), required: true },
      { name: 'children', shape: 'bento-node&[]', shape_ast: list(ref('bento-node')), required: true },
    ],
  },
  {
    name: 'bento-node.leaf',
    parents: ['bento-node'],
    sealed: null,
    fields: [
      { name: 'projection', shape: 'projection::host*', shape_ast: ref('projection::host'), required: false },
      { name: 'config', shape: 'projection-config::host', shape_ast: record('projection-config::host'), required: false },
    ],
  },
  {
    name: 'bento-node.tabgroup',
    parents: ['bento-node'],
    sealed: null,
    fields: [
      { name: 'activeTabIndex', shape: 'Number', shape_ast: prim('Number'), required: true },
      { name: 'tabs', shape: 'bento-node.leaf&[]', shape_ast: list(ref('bento-node.leaf')), required: true },
    ],
  },
]

/**
 * au-host's `range` / `selection` vocabulary: OPEN (non-sealed) extension
 * hierarchies. A base with subtypes that claim `type: <base>`, narrowed at
 * runtime by the instance's `type`. Drives the open-discriminant tests: the
 * base gets `type: string`, each subtype its own `type: '<name>'` literal.
 */
export const rangeSelection: WireTypeDef[] = [
  { name: 'range', parents: [], sealed: null, fields: [] },
  {
    name: 'text-range',
    parents: ['range'],
    sealed: null,
    fields: [
      { name: 'from', shape: 'Number', shape_ast: prim('Number'), required: true },
      { name: 'to', shape: 'Number', shape_ast: prim('Number'), required: true },
    ],
  },
  {
    name: 'selection',
    parents: [],
    sealed: null,
    fields: [{ name: 'range', shape: 'range&', shape_ast: inlineOrRef('range'), required: false }],
  },
  {
    name: 'file-selection',
    parents: ['selection'],
    sealed: null,
    fields: [{ name: 'path', shape: 'String', shape_ast: prim('String'), required: true }],
  },
]

/** A three-level OPEN chain `a ← b ← c`: the mid-tier `b` is both extended and extending. */
export const openMidTier: WireTypeDef[] = [
  { name: 'a', parents: [], sealed: null, fields: [] },
  { name: 'b', parents: ['a'], sealed: null, fields: [{ name: 'x', shape: 'Number', shape_ast: prim('Number'), required: true }] },
  { name: 'c', parents: ['b'], sealed: null, fields: [{ name: 'y', shape: 'Number', shape_ast: prim('Number'), required: true }] },
]

/**
 * The cross-package KIND-BASE case (au-host canvas), as TWO separate package
 * reads. The bug only manifests across reads: a single graph holding both base
 * and subtype would mark the base `extended` and give it `type: string`.
 *
 * `hostSdkKindBase` is host-sdk's read. `container-projection` extends the open
 * `projection` root but has NO co-present subtype (canvas / bento / bar live in
 * OTHER packages), so it is mis-detected as a leaf and emitted with a literal
 * `type: 'container-projection'`.
 *
 * `canvasPkg` is the canvas package read. `container-projection::host-sdk` is
 * BORROWED (a `::repo`-qualified parent, not a def in the read — imported from
 * host-sdk); `canvas` OWNS its interface and extends the imported base with its
 * own `type: 'canvas'`. Combining host-sdk's literal base with canvas's subtype
 * is the TS2430 repro.
 */
export const hostSdkKindBase: WireTypeDef[] = [
  { name: 'projection', parents: [], sealed: null, fields: [] },
  { name: 'container-projection', parents: ['projection'], sealed: null, fields: [] },
]

export const canvasPkg: WireTypeDef[] = [
  {
    name: 'canvas',
    parents: ['container-projection::host-sdk'],
    sealed: null,
    fields: [{ name: 'title', shape: 'String', shape_ast: prim('String'), required: true }],
  },
]

/**
 * The dogfood `xr-consumer` cross-repo slice, VERBATIM from the daemon's scoped
 * read (repo `xr-consumer`): `gadget` extends `widget::xr-base` with NO vendored
 * copy. The peer def `widget` is NOT in the scoped read — only the qualified
 * parent name rides on the wire, the owner (`xr-base`) inside it. Drives the
 * cross-repo qualified-import tests. See
 * [[message - 260707223915 - cross-repo-aware ts emission for repo-qualified referenced types]].
 */
export const xrConsumerSlice: WireTypeDef[] = [
  {
    name: 'gadget',
    parents: ['widget::xr-base'],
    sealed: null,
    fields: [{ name: 'extra', shape: 'String', shape_ast: prim('String'), required: false }],
  },
]

/**
 * Schema 18: meta type-defs mix in the fieldless universal marker
 * `au.engine.meta::au-engine`. `intent.summary` carries it as its only parent
 * (a would-be root); `intent.detail` mixes it alongside a real supertype, to
 * show the strip is surgical. `intent.bare` uses the unqualified marker form, as
 * it would appear in au-engine's own read.
 */
export const metaMarkerSlice: WireTypeDef[] = [
  {
    name: 'intent.summary',
    parents: ['au.engine.meta::au-engine'],
    sealed: null,
    fields: [{ name: 'label', shape: 'String', shape_ast: prim('String'), required: true }],
  },
  {
    name: 'intent',
    parents: [],
    sealed: null,
    fields: [{ name: 'title', shape: 'String', shape_ast: prim('String'), required: true }],
  },
  {
    name: 'intent.detail',
    parents: ['intent', 'au.engine.meta::au-engine'],
    sealed: null,
    fields: [{ name: 'body', shape: 'String', shape_ast: prim('String'), required: true }],
  },
  {
    name: 'intent.bare',
    parents: ['au.engine.meta'],
    sealed: null,
    fields: [{ name: 'note', shape: 'String', shape_ast: prim('String'), required: false }],
  },
]

/**
 * Exercises `#:` docstring emission as JSDoc. `vector` carries a type-level doc,
 * a single-line field doc (`x`), an undocumented field (`y`), and a multi-line
 * field doc (`z`). `shape` is a sealed family with a type-level doc, to pin that
 * a sealed def's doc rides its union alias, not its `Base`.
 */
export const docstringGraph: WireTypeDef[] = [
  {
    name: 'vector',
    doc: 'A 3D vector.',
    parents: [],
    sealed: null,
    fields: [
      { name: 'x', shape: 'Number', shape_ast: prim('Number'), required: true, doc: 'The x component.' },
      { name: 'y', shape: 'Number', shape_ast: prim('Number'), required: true },
      { name: 'z', shape: 'Number', shape_ast: prim('Number'), required: true, doc: 'The z component.\nUp is positive.' },
      // A doc carrying a `*/` (a glob example) must not close the JSDoc block early.
      { name: 'pattern', shape: 'String', shape_ast: prim('String'), required: false, doc: 'a glob, e.g. "**/*.ts".' },
    ],
  },
  {
    name: 'shape',
    doc: 'A drawable shape.',
    parents: [],
    sealed: ['shape.circle'],
    fields: [],
  },
  {
    name: 'shape.circle',
    parents: ['shape'],
    sealed: null,
    fields: [{ name: 'r', shape: 'Number', shape_ast: prim('Number'), required: true, doc: 'Radius.' }],
  },
]

/** Exercises the `any`, `def-reference`, and `pinned` shape kinds end to end. */
export const shapeKindsGraph: WireTypeDef[] = [
  {
    name: 'widget',
    parents: [],
    sealed: null,
    fields: [
      { name: 'blob', shape: 'any', shape_ast: { kind: 'any' }, required: true },
      { name: 'tool', shape: 'type<mcp.tool>*', shape_ast: { kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool' } }, required: false },
      { name: 'anyDef', shape: 'type*', shape_ast: { kind: 'def-reference' }, required: false },
      { name: 'pinnedRef', shape: 'decision*@', shape_ast: { kind: 'pinned', inner: ref('decision') }, required: false },
    ],
  },
]

/**
 * Schema 27: value refinement (`Base{predicate}`) and range cardinality
 * (`inner[min..max]`) end to end. `count` refines a `Number`, `slug` a `String`;
 * `rgb` is a fixed-length triple, `tags` a bounded range. Drives the JSDoc
 * surfacing of a refinement and the optional-tuple cardinality emission.
 */
export const refinementGraph: WireTypeDef[] = [
  {
    name: 'metric',
    parents: [],
    sealed: null,
    fields: [
      {
        name: 'count',
        shape: 'Number{>=0 & integer}',
        shape_ast: { kind: 'refined', base: 'Number', refinement: { lower: { value: '0', inclusive: true }, integer: true } },
        required: true,
      },
      {
        name: 'slug',
        shape: 'String{/^[a-z0-9-]+$/}',
        shape_ast: { kind: 'refined', base: 'String', refinement: { pattern: '^[a-z0-9-]+$' } },
        required: false,
      },
      // rgb: Number[3] — a fixed-length triple.
      { name: 'rgb', shape: 'Number[3]', shape_ast: { kind: 'list', min: 3, max: 3, inner: prim('Number') }, required: true },
      // tags: String[1..4] — a bounded range.
      { name: 'tags', shape: 'String[1..4]', shape_ast: { kind: 'list', min: 1, max: 4, inner: prim('String') }, required: false },
    ],
  },
]

const tuple = (...elements: WireShape[]): WireShape => ({ kind: 'tuple', elements })
const union = (...branches: WireShape[]): WireShape => ({ kind: 'union', branches })

/**
 * Branded types: a def declaring `shape:` instead of `fields:` (empty `fields`,
 * a `brand`). Covers all four forms — a branded scalar (`meter`), a refined
 * scalar (`percent`), a named enum with per-member docs (`icon-role`), a tuple
 * (`rect`), and a structural union over records (`evidence-kind`). `gauge` is a
 * record def whose fields REFERENCE brands by bare name (a `record` shape_ast),
 * to pin that a brand-referencing field resolves to the brand's alias / `$def`.
 */
export const brandGraph: WireTypeDef[] = [
  { name: 'meter', doc: 'a distance in metres', parents: [], sealed: null, fields: [], brand: { shape: prim('Number') } },
  {
    name: 'percent',
    parents: [],
    sealed: null,
    fields: [],
    brand: { shape: { kind: 'refined', base: 'Number', refinement: { lower: { value: '0', inclusive: true }, upper: { value: '100', inclusive: true } } } },
  },
  {
    name: 'icon-role',
    doc: 'semantic icon roles',
    parents: [],
    sealed: null,
    fields: [],
    brand: { shape: enumOf('save', 'delete', 'open'), member_docs: { save: 'persist current state', delete: 'remove the target' } },
  },
  { name: 'rect', doc: 'a bounding box, x y w h', parents: [], sealed: null, fields: [], brand: { shape: tuple(prim('Number'), prim('Number'), prim('Number'), prim('Number')) } },
  { name: 'paper', parents: [], sealed: null, fields: [{ name: 'title', shape: 'String', shape_ast: prim('String'), required: true }] },
  { name: 'observation', parents: [], sealed: null, fields: [{ name: 'seen', shape: 'String', shape_ast: prim('String'), required: true }] },
  { name: 'evidence-kind', parents: [], sealed: null, fields: [], brand: { shape: union(record('paper'), record('observation')) } },
  {
    name: 'gauge',
    parents: [],
    sealed: null,
    fields: [
      { name: 'length', shape: 'meter', shape_ast: record('meter'), required: true },
      { name: 'ratio', shape: 'percent', shape_ast: record('percent'), required: false },
      { name: 'role', shape: 'icon-role', shape_ast: record('icon-role'), required: false },
      { name: 'box', shape: 'rect', shape_ast: record('rect'), required: false },
      { name: 'evidence', shape: 'evidence-kind', shape_ast: record('evidence-kind'), required: false },
    ],
  },
]
