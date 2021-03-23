const tsc = require('./tsc-tools');
const path = require('path');
const fs = require('./file-system');
const { origin, buildRoot, setupTestEnvironment } = require('./test-utils');

const function1Path = 'src/function1';
const libPath = 'src/library';

describe('tsc-tools', () => {
    afterEach(() => {
        process.chdir(origin);
    });

    test('Compile function', () => {
        setupTestEnvironment();
        const fullPath = path.resolve(function1Path);
        console.log(fullPath, fs.existsSync(fullPath));
        tsc.compileTypescript(function1Path, '.build/root', {}, {});

        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js.map`)).toBeTruthy();
    });

    test('System: Compile library', () => {
        setupTestEnvironment();
        const fullPath = path.resolve(libPath);
        console.log(libPath, fs.existsSync(libPath));
        tsc.compileTypescript(libPath, '.build/root', { isLibrary: true }, {});

        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js.map`)).toBeTruthy();
    });
});
