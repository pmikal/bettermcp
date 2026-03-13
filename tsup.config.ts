import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  target: 'node20',
  splitting: false,
  sourcemap: true,
  external: ['better-sqlite3', '@scalar/openapi-parser', '@modelcontextprotocol/sdk', 'json-schema-faker'],
})
