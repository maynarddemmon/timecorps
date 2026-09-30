import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                
                JS: 'readonly',
                myt: 'readonly',
                tc: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'no-extra-boolean-cast': 'off', // if (!!someVar) {   // }
            'no-constant-condition': ['warn', {checkLoops: false}], // while (true) {}
            'no-useless-escape': 'off',
            'no-cond-assign': 'off' // if(a = b)
        }
    },
    {
        // The test harness runs in Node as ES modules. Code passed to page.evaluate runs in
        // the game page, so "tc" stays available as a global there.
        files: ['tests/**/*.mjs', 'playwright.config.mjs'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        }
    }
];