import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // Resolve the Gemini key from whichever env var name is set
    const geminiKey = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || '';

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Legacy process.env references (keep for backward compat)
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        // THIS IS THE KEY FIX: Vite's import.meta.env only auto-exposes VITE_ prefixed vars
        // from .env files. If the Netlify env var is named GEMINI_API_KEY (no VITE_ prefix),
        // it won't show up in import.meta.env. We force it here:
        'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(geminiKey),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
