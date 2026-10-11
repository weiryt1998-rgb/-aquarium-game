import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(root, 'public', 'models');

/**
 * สร้างรายชื่อไฟล์โมเดล (.glb/.gltf) ใน public/models ให้เกมรู้ว่ามีไฟล์ไหนบ้าง
 * → เกมจะโหลดเฉพาะไฟล์ที่มีจริง และรีโหลดหน้าเว็บอัตโนมัติเมื่อเพิ่ม/ลบไฟล์โมเดล
 * ใช้งาน: import availableModels from 'virtual:model-manifest'
 */
function modelManifest() {
  const virtualId = 'virtual:model-manifest';
  const resolvedId = '\0' + virtualId;

  const scan = (dir = modelsDir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return scan(full);
      if (!/\.(glb|gltf)$/i.test(entry.name)) return [];
      return [path.relative(path.join(root, 'public'), full).split(path.sep).join('/')];
    });
  };

  return {
    name: 'model-manifest',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return `export default ${JSON.stringify(scan())};`;
    },
    configureServer(server) {
      server.watcher.add(modelsDir);
      const onChange = (file) => {
        if (!/\.(glb|gltf)$/i.test(file)) return;
        const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph;
        const mod = graph?.getModuleById(resolvedId);
        if (mod) graph.invalidateModule(mod);
        (server.hot ?? server.ws).send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  // ใช้ path แบบ relative เพื่อให้ไฟล์ที่ build แล้วเปิดจากโฟลเดอร์ย่อยใดก็ได้
  base: './',
  plugins: [modelManifest()],
  server: {
    host: true,
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
