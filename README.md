---
type: au.engine.readme::au-engine
tldr: Generates code from au-engine type-defs. Reads a type graph through au-engine-sdk, lowers it to a language-agnostic IR, and emits per target — branded TypeScript types (the primary target) or JSON Schema (Draft 2020-12). Run the `au-type-codegen` bin against a live daemon (`--entry`) or an offline JSON dump (`--types-json`). New target languages plug in as emitters over the shared IR.
---

# Repo Overview

## General Context
Before defining what `au-type-codegen` is,
here is some general context of the environment it exists in.

- `arsumbris` is a framework for agentic knowledge work.
- `au-engine` serves a typed graph over a cross-repo substrate of files.
  - its **type-defs** are the single source of truth for every shape in the graph.
- `au-engine-sdk` is the TypeScript client for the engine daemon.
  - it exposes the type graph, including each def's structured `shape_ast`.

`au-type-codegen` is part of this `arsumbris` framework.


## What this is

`au-type-codegen` turns an au-engine **type-def** into code with the same name and the same type hierarchy.

The family relies on the type system everywhere.
- first-party packages are built against type-defs.
- end users author their own and map projections, MCP tools, and everything else over them.
- so every consuming layer needs the type-defs as native types in its own language.

It stays strictly downstream of the engine.
- the engine owns the grammar and remains the validator.
- codegen maps the engine's structure to a target language, it re-derives nothing.
- generated TypeScript types are compile-time only.

The pipeline is one lowering plus a per-target emitter:

- **input** — a `WireTypeDef[]` type graph, from a live daemon or an offline dump.
- **IR** — a language-agnostic intermediate representation the input lowers to.
- **emitter** — one per target, reads the IR and renders output.

Two targets ship today, both over the same IR:

- **TypeScript** (default) — one branded TS type per type-def.
  - `extends` becomes `extends Omit<Parent, 'type'>`, the hierarchy preserved.
  - a `shape:` brand emits as a type alias over its underlying shape.
    - nominal scalar / tuple brands carry a `& { __brand }` tag; enum / union brands stay structural.
  - references emit as branded link types; docstrings surface as JSDoc.
- **JSON Schema** — Draft 2020-12, one document per type-def or a map of all.
  - used to derive an MCP tool's `inputSchema` from its `mcp.tool` fields.


## How to use this

Consumed as **TypeScript source** — run under Node with type-stripping.
The bin is `au-type-codegen` (`src/cli.ts`); `pnpm gen` wraps it.

```
au-type-codegen --entry <dir> [--repo <name>] [--target ts|json-schema] [--out <file>]
```

Pick an **input** (one is required):
- `--entry <dir>` — attach to the running daemon for this entry and read its type graph.
  - attaches only, never spawns an engine; the dir is the entry folder-repo the daemon homes on.
- `--repo <name>` — scope the read to one workspace member.
  - required for per-package generation; the unscoped read is not the union over members.
- `--types-json <file>` — read a `WireTypeDef[]` JSON dump offline, no daemon.

Pick a **target**:
- `--target ts` — TypeScript module (default).
- `--target json-schema` — JSON Schema; `--type <name>` for one def, else a map of all.

**Output:**
- `--out <file>` — write the result (default: stdout).

TypeScript-target options:
- **Borrows** — a cross-repo dependency surfaces as a `::repo`-qualified reference that imports from the owner's package.
  - `--module-map <file>` — JSON `{ "<owner-repo>": "<module-specifier>" }`.
  - `--module <owner>=<spec>` — one entry inline, repeatable, overlays the file.
  - an unmapped owner is an error.
- **Meta-block emission** — `--meta <type>=<mode>[:<suffix>]`, repeatable.
  - `const` emits a per-host constant from the block's values; `type` resolves a def-ref-list meta to types.
  - `--meta-satisfies` — a const appends `satisfies Omit<MetaInterface, 'type'>`.
- **Enum value arrays** — `--enum-field-values` makes a top-level field enum also emit a runtime value array.
  - a named enum brand always emits one.


## How to extend this

The IR is the seam.
- a new target language plugs in as an **emitter** over the shared IR.
- the input lowering and the IR stay unchanged; only the emitter is new.
- TypeScript and JSON Schema are the two built emitters; other languages come in the same way.

The `src/` layout follows the pipeline:
- `input/` — daemon attach + the `WireTypeDef` wire shape.
- `ir/` — the lowering and the IR model.
- `emit/ts/`, `emit/json-schema/` — the per-target emitters.
