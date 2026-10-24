import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 3000 is SpacetimeDB, 8080 cannot be bound on the dev laptop; 5173 is Vite's default.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
});
