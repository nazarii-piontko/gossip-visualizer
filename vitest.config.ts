import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // viz tests opt into jsdom via // @vitest-environment jsdom
    globals: true,
  },
});
