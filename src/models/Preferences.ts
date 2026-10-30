/**
 * Provider Preferences/Settings
 */

export interface Preference {
  id: string;
  label: string;
  type: 'enum' | 'bool' | 'text';
  default: string;
  values?: string[];
}

export interface PreferencesResponse {
  MediaContainer: {
    size: number;
    Setting: Preference[];
  };
}

/**
 * Available preferences for the anime provider
 */
export const ANIME_PREFERENCES: Preference[] = [
  {
    id: 'titleLanguage',
    label: 'Preferred Title Language',
    type: 'enum',
    default: 'english',
    values: ['english', 'romaji', 'japanese', 'german', 'french', 'spanish'],
  },
];

export function getPreferencesResponse(): PreferencesResponse {
  return {
    MediaContainer: {
      size: ANIME_PREFERENCES.length,
      Setting: ANIME_PREFERENCES,
    },
  };
}
