import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import projectFiles from './vite-plugin-project-files'
import fonts from './vite-plugin-fonts'

/**
 * Loopback-only by default. The dev server hosts an unauthenticated file API that can read,
 * overwrite and delete anything in projects/ — binding it to every interface would hand that
 * to anyone sharing the network.
 *
 * Opt into LAN exposure deliberately when you want to preview on a phone:
 *   SM_HOST=lan npm run dev          → bind 0.0.0.0
 *   SM_HOST=192.168.1.20 npm run dev → bind one specific interface
 *
 * Note that both dev APIs stay loopback-only even then — each enforces that itself, per
 * request, rather than trusting this setting. LAN clients get the app, not the APIs.
 */
const host = !process.env.SM_HOST
  ? '127.0.0.1'
  : process.env.SM_HOST === 'lan'
    ? true
    : process.env.SM_HOST

export default defineConfig({
  plugins: [react(), projectFiles(), fonts()],
  server: { port: 5173, host }
})
