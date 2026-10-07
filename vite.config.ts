import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          resume: path.resolve(__dirname, 'resume.html'),
        },
      },
    },
    plugins: [
      {
        name: 'copy-static-portfolio-assets',
        closeBundle() {
          const copy = (src: string, dest: string) => {
            if (!fs.existsSync(src)) return;
            const stat = fs.statSync(src);
            if (stat.isDirectory()) {
              if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
              for (const file of fs.readdirSync(src)) {
                copy(path.join(src, file), path.join(dest, file));
              }
            } else {
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.copyFileSync(src, dest);
            }
          };
          copy(path.resolve(__dirname, 'script.js'), path.resolve(__dirname, 'dist/script.js'));
          copy(path.resolve(__dirname, 'style.css'), path.resolve(__dirname, 'dist/style.css'));
          copy(path.resolve(__dirname, 'frames'), path.resolve(__dirname, 'dist/frames'));
          copy(path.resolve(__dirname, 'assets'), path.resolve(__dirname, 'dist/assets'));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

