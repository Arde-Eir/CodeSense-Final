import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'SENTRY_')
  const sentryBuildKeys = ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN'] as const
  const hasSentryBuildConfig = sentryBuildKeys.some(key => Boolean(env[key]?.trim()))
  const missingSentryBuildKeys = sentryBuildKeys.filter(key => !env[key]?.trim())
  if (command === 'build' && hasSentryBuildConfig && missingSentryBuildKeys.length > 0) {
    throw new Error(`Sentry source-map uploads require all build credentials. Missing: ${missingSentryBuildKeys.join(', ')}.`)
  }
  const uploadSourceMaps = command === 'build' && hasSentryBuildConfig

  return {
    plugins: [
      react(),
      uploadSourceMaps && sentryVitePlugin({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        sourcemaps: {
          assets: './dist/**',
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'vendor-monaco'
            if (id.includes('@xyflow') || id.includes('d3')) return 'vendor-visualizer'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react'
            return undefined
          },
        },
      },
    },
  }
})
