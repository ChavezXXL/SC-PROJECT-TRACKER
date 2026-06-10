import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: 'localhost',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Function form — the object form left vendor-react EMPTY because
        // module ids didn't match the bare specifiers, so React shipped
        // inside the 1.6MB index chunk and broke long-term caching.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('victory-vendor') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('firebase') || id.includes('grpc') || id.includes('protobufjs')) return 'vendor-firebase';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          return undefined;
        }
      }
    }
  }
});
