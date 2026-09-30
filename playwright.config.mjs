import {defineConfig} from '@playwright/test';
import {PORT, BASE_URL} from './tests/helpers.mjs';

export default defineConfig({
    testDir:'tests',
    fullyParallel:true,
    reporter:'list',
    use:{
        baseURL:BASE_URL,
        // The layout needs a wide window, like the game itself.
        viewport:{width:1700, height:1000}
    },
    projects:[{name:'chromium', use:{browserName:'chromium'}}],
    webServer:{
        command:'node tests/server.mjs ' + PORT,
        url:BASE_URL + '/index.html',
        reuseExistingServer:!process.env.CI
    }
});
