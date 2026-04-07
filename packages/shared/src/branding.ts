/**
 * Centralized branding assets for Scrunchy
 * Based on Craft Agents (https://github.com/lukilabs/scrunchy-oss)
 */

export const APP_NAME = 'Scrunchy';
export const ATTRIBUTION = 'Based on Craft Agents';

export const SCRUNCHY_LOGO = [
  '  ████████  ████████ ████████  ██    ██ ██    ██  ████████ ██    ██ ██    ██',
  '██████████ ██████████ ████████ ██    ██ ███   ██ ██████████ ██    ██  ██  ██',
  '██████     ██████     ██    ██ ██    ██ ████  ██ ██████     ██    ██   ████ ',
  '  ██████   ██         ████████ ██    ██ ██ ██ ██ ██         ████████    ██  ',
  '    ██████ ██████     ██  ██   ██    ██ ██  ████ ██████     ██    ██    ██  ',
  '██████████ ██████████ ██   ██  ████████ ██   ███ ██████████ ██    ██    ██  ',
  '  ████████  ████████  ██    ██  ██████  ██    ██  ████████  ██    ██    ██  ',
] as const;

/** Logo as a single string for HTML templates */
export const SCRUNCHY_LOGO_HTML = SCRUNCHY_LOGO.map((line) => line.trimEnd()).join('\n');

// Legacy aliases for backward compatibility
export const CRAFT_LOGO = SCRUNCHY_LOGO;
export const CRAFT_LOGO_HTML = SCRUNCHY_LOGO_HTML;

/** Session viewer base URL */
// TODO: Configure your own viewer/sharing URL
// export const VIEWER_URL = 'https://your-domain.com';
export const VIEWER_URL = '';
