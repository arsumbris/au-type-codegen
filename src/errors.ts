/** A codegen failure with a human-facing message. Thrown by the IR builder and emitters. */
export class CodegenError extends Error {
  override name = 'CodegenError'
}

/**
 * Exhaustiveness assertion for a `WireShape` switch. The `never` parameter makes
 * a switch that misses a kind a COMPILE error (the unhandled member is not
 * assignable to `never`), and the throw is a runtime backstop if the wire ever
 * carries a kind the types do not. Call it in the `default` arm.
 */
export function assertNeverShape(shape: never): never {
  throw new CodegenError(`unhandled shape kind: ${(shape as { kind: string }).kind}`)
}
