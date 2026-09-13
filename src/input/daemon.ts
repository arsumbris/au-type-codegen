// Read the type graph from a running engine daemon, through au-engine-sdk.
//
// Codegen is an ATTACHER, not a spawner: it connects to an existing daemon via
// `DaemonClient.connect` and never spawns an engine. The entry is a folder-repo
// DIRECTORY (a directory carrying `.arsumbris/repo.yaml`, schema 16), the path
// the daemon self-homes on. The SDK derives the socket from it — a hashed path
// OUTSIDE the entry, `$HOME/.arsumbris/sockets/<hash>.sock` (`socketPath`), not
// the former in-entry `.arsumbris/daemon.sock`. So both sides must be pointed at
// the SAME entry directory (it is realpath'd then hashed).
//
// The engine is single-owner per entry; everyone else attaches. (We deliberately
// do not use the SDK's DaemonSupervisor.) If no daemon is running, the connect
// fails — it is not respawned.

import { DaemonClient, readTypes } from '@arsumbris/au-engine-sdk'
import type { WireTypeDef } from './wire.ts'

/**
 * Read a type graph for an entry by attaching to its running daemon. `repo`
 * scopes the read to one workspace member's graph (its declared name); absent
 * reads the root repo. The unscoped read is NOT the union over members, so
 * per-package generation must pass an explicit `repo`. Throws on a rejected
 * read, a still-deriving graph, or an unknown `repo` (a null result).
 *
 * The scoped read returns the repo's OWN defs only. A cross-repo dependency is
 * not a def here — it surfaces as a `::repo`-qualified reference inside an owned
 * def, which the emitter resolves to an import. So the one read is enough to
 * generate-owned / import-borrowed, no provenance field needed.
 */
export async function readTypesFromDaemon(entry: string, repo?: string): Promise<WireTypeDef[]> {
  const client = await DaemonClient.connect(entry)
  try {
    const res = await readTypes(client, repo ? { repo } : undefined)
    // Only the rejection arm carries `ok`; discriminate on it first.
    if ('ok' in res) throw new Error(`types read rejected: ${res.error}`)
    if (!res.ready) throw new Error('type graph is still deriving; retry once the daemon is ready')
    // An unknown repo resolves to a null result (the wire's unresolved-lookup signal).
    if (res.result === null) throw new Error(`unknown repo '${repo}': no workspace member by that name`)
    return res.result
  } finally {
    client.close()
  }
}
