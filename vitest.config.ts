import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Entegrasyon testleri yerel Postgres'te veritabanı oluşturur; paralel
    // CREATE DATABASE template kilidine takılmasın diye dosyalar sırayla koşar.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
