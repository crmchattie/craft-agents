#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getScrunchyReadOnlyBashPatterns } from './cli-domains.ts'

interface AllowedBashEntry {
  pattern: string
  comment?: string
}

interface PermissionsConfig {
  version?: string
  allowedBashPatterns?: AllowedBashEntry[]
  [key: string]: unknown
}

function isScrunchyPattern(entry: AllowedBashEntry): boolean {
  return typeof entry.pattern === 'string' && entry.pattern.startsWith('^scrunchy\\s')
}

function syncScrunchyPatterns(config: PermissionsConfig): PermissionsConfig {
  const patterns = config.allowedBashPatterns ?? []
  const firstScrunchyIndex = patterns.findIndex(isScrunchyPattern)

  const withoutScrunchy = patterns.filter(entry => !isScrunchyPattern(entry))
  const generated = getScrunchyReadOnlyBashPatterns()

  const insertAt = firstScrunchyIndex >= 0 ? firstScrunchyIndex : withoutScrunchy.length
  const nextAllowedBashPatterns = [
    ...withoutScrunchy.slice(0, insertAt),
    ...generated,
    ...withoutScrunchy.slice(insertAt),
  ]

  return {
    ...config,
    allowedBashPatterns: nextAllowedBashPatterns,
  }
}

function main() {
  const targetPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'apps/electron/resources/permissions/default.json')

  const config = JSON.parse(readFileSync(targetPath, 'utf-8')) as PermissionsConfig
  const nextConfig = syncScrunchyPatterns(config)

  writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8')
  process.stdout.write(`Synced scrunchy bash patterns in ${targetPath}\n`)
}

if (import.meta.main) {
  main()
}
