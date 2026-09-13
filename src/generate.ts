// The whole pipeline in one call: type graph → TypeScript module.

import { emitTypeScript, type EmitConfig } from './emit/ts/emit.ts'
import { buildIR } from './ir/build.ts'
import type { WireTypeDef } from './input/wire.ts'

export function generate(defs: WireTypeDef[], config: EmitConfig = {}): string {
  return emitTypeScript(buildIR(defs), config)
}
