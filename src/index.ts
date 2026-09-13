// au-type-codegen — generate code from au-engine type-defs.
//
// Pipeline: au-engine-sdk type graph (incl. shape_ast) → IR → emitter → output.
// See [[spec - typescript codegen - type-defs to branded ts types preserving name and hierarchy]].

export { CodegenError } from './errors.ts'
export type { WireField, WireMetaBlock, WireMetaField, WireShape, WireTypeDef, WireTypesResult } from './input/wire.ts'
export { buildIR } from './ir/build.ts'
export type { FieldModel, TypeGraphIR, TypeModel } from './ir/ir.ts'
export { emitTypeScript } from './emit/ts/emit.ts'
export { emitJsonSchema } from './emit/json-schema/emit.ts'
export type { JsonSchema } from './emit/json-schema/schema.ts'
export { generate } from './generate.ts'
export { readTypesFromDaemon } from './input/daemon.ts'
