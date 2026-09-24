import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' } },
  optimizeDeps: {
    include: [
      'three',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/HDRLoader.js',
      'three/addons/controls/OrbitControls.js',
      'three/addons/environments/RoomEnvironment.js',
      'three/addons/libs/meshopt_decoder.module.js',
      'three-mesh-bvh'
    ]
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 }
});
