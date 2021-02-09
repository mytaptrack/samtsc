const { SAMCompiledDirectory } = require('./compiled-directory');
const { getRootDir, origin, setupTestEnvironment, buildRoot } = require('../test-utils');
const { existsSync, readFileSync, lstatSync } = require('../file-system');

const function1Path = 'src/function1';
const function2Path = 'src/function2';
const libraryPath = 'src/library';

function setupEnvironmentCompDirs() {
    const testRoot = setupTestEnvironment();

    process.chdir(testRoot);

    const function1 = new SAMCompiledDirectory(function1Path, { no_deploy: true }, buildRoot);
    const function2 = new SAMCompiledDirectory(function2Path, { no_deploy: true }, buildRoot);
    const library = new SAMCompiledDirectory(libraryPath, { no_deploy: true }, buildRoot);
    library.isLibrary = true;

    return {
        function1,
        function2,
        library
    }
}

function cleanup(function1, function2, library) {
    function1.cleanup();
    function2.cleanup();
    library.cleanup();
}

describe('compiled-directory', () => {
    test('empty', async () => {} );

    test('build function 1 no deploy', () => {
        jest.setTimeout(60 * 1000);
        const {function1, function2, library} = setupEnvironmentCompDirs();
        try {
            function1.build(null, true);
            expect(existsSync(`${buildRoot}/${function1.path}/index.js`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function1.path}/index.js.map`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function1.path}/package.json`)).toBeTruthy();
            expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function2.path}/package.json`)).toBeFalsy();

            const pck = JSON.parse(readFileSync(`${buildRoot}/${function1.path}/package.json`));
            expect(Object.keys(pck.dependencies || {}).length).toBe(0);
        } finally {
            cleanup(function1, function2, library);
        }
    });

    test('build function 1 twice', () => {
        const {function1, function2, library} = setupEnvironmentCompDirs();
        try {
            function1.build(null, true);
            expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
            const before = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            function1.build(null, true);
            const after = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            expect(before.mtimeMs).toBe(after.mtimeMs);
        } finally {
            cleanup(function1, function2, library);
        }
    });

    test('build library no deploy', () => {
        const { library, function1, function2 } = setupEnvironmentCompDirs();
        try {
            library.build(null, true);

            // Check locally for referencing and debugging
            expect(existsSync(`${library.path}/dist/index.js`)).toBeTruthy();
            expect(existsSync(`${library.path}/dist/index.js.map`)).toBeTruthy();
            expect(existsSync(`${library.path}/package.json`)).toBeTruthy();

            // Check build dir
            expect(existsSync(`${buildRoot}/${library.path}/dist/index.js`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${library.path}/dist/index.js.map`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${library.path}/package.json`)).toBeTruthy();
            expect(existsSync(`.build/hash/src-library`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function1.path}/package.json`)).toBeFalsy();

            const pck = JSON.parse(readFileSync(`${buildRoot}/${library.path}/package.json`));
            expect(Object.keys(pck.dependencies || {}).length).toBe(0);
        } finally {
            cleanup(function1, function2, library);
        }
    });
});