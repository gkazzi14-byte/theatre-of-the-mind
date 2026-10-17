import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844}},webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}]});
