import { defineConfig } from 'vitest/config'
import path from 'node:path'
import type { Plugin } from 'vite'

const bunSqliteShim: Plugin = {
  name: 'bun-sqlite-shim',
  resolveId(id) {
    if (id === 'bun:sqlite') return '\0bun:sqlite'
    return null
  },
  load(id) {
    if (id === '\0bun:sqlite') {
      return `
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { DatabaseSync } = req('node:sqlite')

export class Database {
  constructor(p) {
    this._db = new DatabaseSync(p)
  }
  run(sql) {
    this._db.exec(sql)
  }
  query(sql) {
    const db = this._db
    return {
      all(...params) {
        return db.prepare(sql).all(...params).map(r => Object.assign({}, r))
      }
    }
  }
  close() {
    this._db.close()
  }
}
`
    }
    return null
  },
}

export default defineConfig({
  plugins: [bunSqliteShim],
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
