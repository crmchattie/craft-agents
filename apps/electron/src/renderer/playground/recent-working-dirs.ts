export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/scrunchy',
    '/Users/demo/projects/scrunchy/apps/electron',
    '/Users/demo/projects/scrunchy/packages/shared',
  ],
  many: [
    '/Users/demo/projects/scrunchy',
    '/Users/demo/projects/scrunchy/apps/electron',
    '/Users/demo/projects/scrunchy/apps/viewer',
    '/Users/demo/projects/scrunchy/apps/cli',
    '/Users/demo/projects/scrunchy/packages/shared',
    '/Users/demo/projects/scrunchy/packages/server-core',
    '/Users/demo/projects/scrunchy/packages/pi-agent-server',
    '/Users/demo/projects/scrunchy/packages/ui',
    '/Users/demo/projects/scrunchy/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
