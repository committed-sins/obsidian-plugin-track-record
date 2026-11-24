import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
    globalIgnores(['node_modules/**', 'dist/**', 'scripts/**', 'tests/**', 'docs/**', 'eslint.config.mjs']),
    ...obsidianmd.configs.recommended,
    { languageOptions: { parserOptions: { projectService: true } } },
    // These validators intentionally detect control characters in user input.
    { files: ['src/settings.ts', 'src/records.ts'], rules: { 'no-control-regex': 'off' } }
]);
