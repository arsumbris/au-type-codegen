// Enum value arrays: an enum's literals emitted as a runtime `as const` array,
// beside the union TYPE the shape table already produces.
//
// A TS union type erases at compile time, so a consumer cannot iterate it (build
// a UI per member) or membership-test it (validate untrusted input). The union
// alone forces a hand-mirrored value list guarded against drift. This emits the
// faithful list instead, so the consumer derives it. A faithful data constant,
// not re-derived logic — the same category as a meta-block const, the engine
// stays the validator.
//
// A NAMED enum brand always emits (`KeyName` → `KeyNameValues`): named, cheap,
// one const per def. A FIELD enum emits only when opted in (`LayerPrimitive.kind`
// → `LayerPrimitiveKindValues`), matching the meta-const opt-in stance. Top-level
// enums only. See
// [[decision - 2609092043 - emit runtime enum value arrays, brands always field enums opt-in]].

import { CodegenError } from '../../errors.ts'
import type { TypeModel } from '../../ir/ir.ts'
import { pascalName } from './names.ts'

/** An enum's members as a faithful `['a', 'b'] as const` literal. Members follow the legal-names regex, so none needs escaping (the same assumption the shape table's `quoted` makes). */
const renderMembers = (members: string[]): string => `[${members.map((m) => `'${m}'`).join(', ')}] as const`

/**
 * Emit the enum value-array constants over the owned defs.
 * - a brand whose shape is an enum → `export const <Brand>Values = [...] as const`, ALWAYS.
 * - a field whose top-level shape is an enum → `export const <Host><Field>Values = [...] as const`,
 *   only when `fieldEnums` is true.
 * `nameOf` maps a canonical type name to its TS identifier (the same map the type
 * emission uses, so a const sits beside the type it mirrors). Throws on a name
 * collision (two consts folding to one identifier), mirroring `emitMetaConstants`.
 */
export function emitEnumValues(
  owned: TypeModel[],
  nameOf: (canonical: string) => string,
  fieldEnums: boolean,
): string[] {
  const blocks: string[] = []
  const byConstName = new Map<string, string>() // const name → the origin that owns it

  const claim = (constName: string, origin: string): void => {
    const prior = byConstName.get(constName)
    if (prior !== undefined && prior !== origin) {
      throw new CodegenError(`enum value arrays '${prior}' and '${origin}' both map to '${constName}'`)
    }
    byConstName.set(constName, origin)
  }

  for (const type of owned) {
    // A named enum brand: always. The brand's TS name is the const stem.
    if (type.brand?.shape.kind === 'enum') {
      const constName = `${nameOf(type.name)}Values`
      claim(constName, `${type.name} (brand)`)
      blocks.push(`export const ${constName} = ${renderMembers(type.brand.shape.members)}`)
      continue // a brand has no fields of its own
    }
    if (!fieldEnums) continue
    // A top-level field enum: opt-in. The const stem is host TS name + PascalCase field.
    for (const field of type.fields) {
      if (field.shape?.kind !== 'enum') continue
      const constName = `${nameOf(type.name)}${pascalName(field.name)}Values`
      claim(constName, `${type.name}.${field.name}`)
      blocks.push(`export const ${constName} = ${renderMembers(field.shape.members)}`)
    }
  }

  return blocks
}
