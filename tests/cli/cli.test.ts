import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { generate } from '../../src/generate.ts'
import { fixtureGraph, toolInputGraph } from '../fixtures/type-graphs.ts'

describe('cli', () => {
  test('generate() is the full pipeline', () => {
    expect(generate(fixtureGraph)).toContain('export type Decision = DecisionPending | DecisionDecided')
  })

  test('--types-json offline source emits to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-cli-'))
    const jsonFile = join(dir, 'types.json')
    writeFileSync(jsonFile, JSON.stringify(fixtureGraph))

    const stdout = execFileSync('node', ['--experimental-transform-types', 'src/cli.ts', '--types-json', jsonFile], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toBe(generate(fixtureGraph))
    expect(stdout).toContain("export type Ref<T extends string>")
  })

  test('--out writes a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-cli-'))
    const jsonFile = join(dir, 'types.json')
    const outFile = join(dir, 'generated.ts')
    writeFileSync(jsonFile, JSON.stringify(fixtureGraph))

    execFileSync('node', ['--experimental-transform-types', 'src/cli.ts', '--types-json', jsonFile, '--out', outFile], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(readFileSync(outFile, 'utf8')).toBe(generate(fixtureGraph))
  })

  test('--enum-field-values opts field enums into a value array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-cli-'))
    const jsonFile = join(dir, 'types.json')
    writeFileSync(jsonFile, JSON.stringify(fixtureGraph))

    const stdout = execFileSync('node', ['--experimental-transform-types', 'src/cli.ts', '--types-json', jsonFile, '--enum-field-values'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toBe(generate(fixtureGraph, { enumFieldValues: true }))
    expect(stdout).toContain("export const AssumptionConfidenceValues = ['low', 'medium', 'high'] as const")
  })

  test('no source is an error', () => {
    expect(() => execFileSync('node', ['--experimental-transform-types', 'src/cli.ts'], { cwd: process.cwd(), stdio: 'pipe' })).toThrow()
  })

  test('--target json-schema --type emits one Draft 2020-12 schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-cli-'))
    const jsonFile = join(dir, 'types.json')
    writeFileSync(jsonFile, JSON.stringify(toolInputGraph))

    const stdout = execFileSync(
      'node',
      ['--experimental-transform-types', 'src/cli.ts', '--types-json', jsonFile, '--target', 'json-schema', '--type', 'toolInput.read_file'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const schema = JSON.parse(stdout)
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['file_path'])
  })
})
