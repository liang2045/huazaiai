import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
var canvasZoomRangePlugin = function () { return ({
    name: 'canvas-zoom-range',
    enforce: 'pre',
    transform: function (code, id) {
        var normalized = id.replace(/\\/g, '/');
        if (!normalized.endsWith('/src/components/Canvas.tsx'))
            return null;
        var marker = 'defaultEdgeOptions={memoDefaultEdgeOptions}';
        if (!code.includes(marker) || code.includes('minZoom=') || code.includes('onWheelCapture='))
            return null;
        return code.replace(marker, "".concat(marker, "\n        minZoom={0.15}\n        maxZoom={3}"));
    },
}); };
// 端口策略:前端 11422 / 本地服务 18766(避开主项目 5176/18765 与常见 51xx 占用)
export default defineConfig({
    plugins: [canvasZoomRangePlugin(), react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 11422,
        strictPort: true,
        host: '127.0.0.1',
        proxy: {
            // 后端 API 代理
            '/api': {
                target: 'http://127.0.0.1:18766',
                changeOrigin: true,
            },
            // 静态文件服务代理
            '/files': {
                target: 'http://127.0.0.1:18766',
                changeOrigin: true,
            },
            '/output': {
                target: 'http://127.0.0.1:18766',
                changeOrigin: true,
            },
            '/input': {
                target: 'http://127.0.0.1:18766',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom'],
                    'xyflow': ['@xyflow/react'],
                },
            },
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify('3.2.3'),
        __APP_NAME__: JSON.stringify('iMade'),
    },
});
