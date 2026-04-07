export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'automation' | 'permission' | 'theme'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: 'scrunchy label --help',
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      'scrunchy label list',
      'scrunchy label create --name "Bug" --color "accent"',
      'scrunchy label update bug --json \'{"name":"Bug Report"}\'',
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: 'scrunchy source --help',
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      'scrunchy source list',
      'scrunchy source get <slug>',
      'scrunchy source update <slug> --json "{...}"',
      'scrunchy source validate <slug>',
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: 'scrunchy skill --help',
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      'scrunchy skill list',
      'scrunchy skill get <slug>',
      'scrunchy skill update <slug> --json "{...}"',
      'scrunchy skill validate <slug>',
    ],
  },
  automation: {
    namespace: 'automation',
    helpCommand: 'scrunchy automation --help',
    workspacePathScopes: ['automations.json', 'automations-history.jsonl'],
    readActions: ['list', 'get', 'validate', 'history', 'last-executed', 'test', 'lint'],
    quickExamples: [
      'scrunchy automation list',
      'scrunchy automation create --event UserPromptSubmit --prompt "Summarize this prompt"',
      'scrunchy automation update <id> --json "{\"enabled\":false}"',
      'scrunchy automation history <id> --limit 20',
      'scrunchy automation validate',
    ],
    bashGuardPaths: ['automations.json', 'automations-history.jsonl'],
  },
  permission: {
    namespace: 'permission',
    helpCommand: 'scrunchy permission --help',
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      'scrunchy permission list',
      'scrunchy permission get --source linear',
      'scrunchy permission add-mcp-pattern "list" --comment "All list ops" --source linear',
      'scrunchy permission validate',
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: 'scrunchy theme --help',
    workspacePathScopes: ['config.json', 'theme.json', 'themes/*.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      'scrunchy theme get',
      'scrunchy theme list-presets',
      'scrunchy theme set-color-theme nord',
      'scrunchy theme set-workspace-color-theme default',
      'scrunchy theme set-override --json "{\"accent\":\"#3b82f6\"}"',
    ],
    bashGuardPaths: ['config.json', 'theme.json', 'themes/*.json'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by scrunchy CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const SCRUNCHY_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const SCRUNCHY_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for scrunchy CLI owned paths.
 */
export const SCRUNCHY_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const SCRUNCHY_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only scrunchy bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getScrunchyReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `^scrunchy\\s+${namespace}\\s+(${actions})\\b`,
      comment: `scrunchy ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: '^scrunchy\\s*$', comment: 'scrunchy bare invocation (prints help)' },
    { pattern: `^scrunchy\\s+(${namespaceAlternation})\\s*$`, comment: 'scrunchy entity help' },
    { pattern: `^scrunchy\\s+(${namespaceAlternation})\\s+--help\\b`, comment: 'scrunchy entity help flags' },
    { pattern: '^scrunchy\\s+--(help|version|discover)\\b', comment: 'scrunchy global flags' },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
