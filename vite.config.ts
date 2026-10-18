import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from 'vite-plugin-web-extension';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
		plugins: [
			react(),
			webExtension({
				disableAutoLaunch: true,
			}),
		],
	build:
		mode === 'development'
			? {
					watch: {
						chokidar: {
							usePolling: true,
							interval: 1000,
						},
					},
				}
			: undefined,
	resolve: {
		alias: {
			'@sidepanel': resolve(__dirname, 'src/sidepanel'),
			'@background': resolve(__dirname, 'src/background'),
			'@shared': resolve(__dirname, 'src/shared'),
		},
	},
}));
