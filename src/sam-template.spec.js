const { execSync } = require('child_process');
const { resolve } = require('path');
const { rmdirSync, existsSync, readFileSync, lstatSync, mkdir, copyFolder } = require('./file-system');
let sam;

const origin = process.cwd();
const targetProject = resolve('samples/stack_layer');
const buildRoot = '.build/root';
const function1Path = 'src/function1';
const function2Path = 'src/function2';
const libraryPath = 'src/library';


describe('sam-template', () => {
    describe('SAMCompiledDirectory', () => {
        const events = {
            emit: jest.fn()
        };
        let function1;
        let function2;
        let library;
        let projectRoot;
        beforeAll(() => {
        });

        beforeEach(async () => {
            projectRoot = resolve(origin + '/.test/' + new Date().getTime());
            console.log(projectRoot);
            mkdir(projectRoot);
            copyFolder(targetProject, projectRoot);
            
            process.chdir(projectRoot);
            execSync('npm i', { stdio: 'inherit' });
            sam = require('./sam-template');
            sam.setBuildRoot(buildRoot);

            events.emit.mockReset();
            mkdir('.build/hash');

            function1 = new sam.SAMCompiledDirectory(function1Path, {}, events, 'test');
            function2 = new sam.SAMCompiledDirectory(function2Path, {}, events, 'test');
            library = new sam.SAMCompiledDirectory(libraryPath, {}, events, 'test');
            library.isLibrary = true;
        });
        afterEach(() => {
            function1.cleanup();
            function2.cleanup();
            library.cleanup();
            process.chdir(origin);
        });

        test('build function 1 no deploy', () => {
            function1.build(null, true);
            expect(existsSync(`${buildRoot}/${function1.path}/index.js`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function1.path}/index.js.map`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function1.path}/package.json`)).toBeTruthy();
            expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
            expect(existsSync(`${buildRoot}/${function2.path}/package.json`)).toBeFalsy();

            const pck = JSON.parse(readFileSync(`${buildRoot}/${function1.path}/package.json`));
            expect(Object.keys(pck.dependencies || {}).length).toBe(0);
        });

        test('build function 1 twice', () => {
            function1.build(null, true);
            expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
            const before = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            function1.build(null, true);
            const after = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            expect(before.mtimeMs).toBe(after.mtimeMs);
        });

        test('build library no deploy', () => {
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
        });
    });
});