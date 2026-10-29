import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over HTTPS on the LAN so an iPad can use the audio input
// (getUserMedia needs a secure context).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { host: mode === 'https' ? true : undefined },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
}));
