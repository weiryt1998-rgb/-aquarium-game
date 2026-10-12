import { defineConfig } from 'vite';

/**
 * build Cloud Functions: รวม functions/src/index.js กับกฎเกมใน src/shared/ (และข้อมูลปลา/ราคาที่ใช้)
 * ให้เป็นไฟล์เดียว functions/lib/index.js — เซิร์ฟเวอร์จึงใช้กฎชุดเดียวกับในเกมแน่นอน
 * ใช้งาน: npm run build:functions (firebase deploy เรียกให้อัตโนมัติผ่าน predeploy)
 */
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'functions/src/index.js',
    outDir: 'functions/lib',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [/^firebase-(admin|functions)(\/.*)?$/],
      output: { format: 'es', entryFileNames: 'index.js' },
    },
  },
  ssr: { target: 'node', noExternal: true },
});
