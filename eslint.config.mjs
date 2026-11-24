import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
    globalIgnores(['node_modules/**', 'dist/**', 'scripts/**', 'tests/**', 'docs/**', 'eslint.config.mjs']),
    ...obsidianmd.configs.recommended,
    { languageOptions: { parserOptions: { projectService: true } } }
]);
