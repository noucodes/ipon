import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Read-only overview website for Ipon. Set VITE_API_URL to the Render API URL.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
