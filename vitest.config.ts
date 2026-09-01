import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'at-*/vitest.config.ts',
    ],
  },
})
