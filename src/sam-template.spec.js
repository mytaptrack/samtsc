const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const { resolve } = require('path');
const { samconfig } = require('./sam/samconfig');
const { existsSync, readFileSync, lstatSync, mkdir, copyFolder, touch, rmdirSync } = require('./file-system');

const origin = process.cwd();
const targetProject = resolve('samples/stack_layer');
const buildRoot = '.build/root';
const function1Path = 'src/function1';
const function2Path = 'src/function2';
const libraryPath = 'src/library';

function getRootDir(exp) {
    if(typeof exp == 'string') {
        return resolve(origin, '.test', exp.replace(/\W/g, '-'));
    }
    return resolve(origin, '.test', exp.getState().currentTestName.replace(/\W/g, '-'));
}

function setupDir(testName) {
    const projectRoot = getRootDir(testName);
    if(existsSync(projectRoot)) {
        rmdirSync(projectRoot);
    }
    mkdir(projectRoot);
    process.chdir(projectRoot);
    console.log(projectRoot);
    mkdir(projectRoot);
    copyFolder(resolve(origin, targetProject), projectRoot);
    
    process.chdir(projectRoot);
    mkdir('.build/root');
    mkdir('.build/hash');
    execSync('npm i', { stdio: 'inherit' });
}

describe('sam-template', () => {
    describe('SAMCompiledDirectory', () => {
        const events = {
            emit: jest.fn()
        };

        afterAll(() => {
            process.chdir(origin);
        });

        test('build function 1 no deploy', () => {
            setupDir('sam-template-SAMCompiledDirectory-build function 1 no deploy');
            let function1;
            let function2;
            let library;
            const testRoot = getRootDir(expect);
            process.chdir(testRoot);
            samconfig.load({}, '.build/root');
            const sam = require('./sam-template');
            sam.setBuildRoot('.build/root');
        
            events.emit.mockReset();
            function1 = new sam.SAMCompiledDirectory(function1Path, {}, events, 'test');
            function2 = new sam.SAMCompiledDirectory(function2Path, {}, events, 'test');
            library = new sam.SAMCompiledDirectory(libraryPath, {}, events, 'test');
            library.isLibrary = true;

            const projectRoot = getRootDir(expect);
            process.chdir(projectRoot);
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
            setupDir('sam-template-SAMCompiledDirectory-build function 1 twice');
            let function1;
            let function2;
            let library;
            const testRoot = getRootDir(expect);
            process.chdir(testRoot);
            samconfig.load({}, '.build/root');
            const sam = require('./sam-template');
            sam.setBuildRoot('.build/root');
        
            events.emit.mockReset();
            function1 = new sam.SAMCompiledDirectory(function1Path, {}, events, 'test');
            function2 = new sam.SAMCompiledDirectory(function2Path, {}, events, 'test');
            library = new sam.SAMCompiledDirectory(libraryPath, {}, events, 'test');
            library.isLibrary = true;
            
            const projectRoot = getRootDir(expect);;
            process.chdir(projectRoot);
            function1.build(null, true);
            expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
            const before = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            function1.build(null, true);
            const after = lstatSync(`${buildRoot}/${function1.path}/index.js`);
            expect(before.mtimeMs).toBe(after.mtimeMs);
        });

        test('build library no deploy', () => {
            setupDir('sam-template-SAMCompiledDirectory-build library no deploy');
            let function1;
            let function2;
            let library;
            const testRoot = getRootDir(expect);
            process.chdir(testRoot);
            samconfig.load({}, '.build/root');
            const sam = require('./sam-template');
            sam.setBuildRoot('.build/root');
        
            events.emit.mockReset();
            function1 = new sam.SAMCompiledDirectory(function1Path, {}, events, 'test');
            function2 = new sam.SAMCompiledDirectory(function2Path, {}, events, 'test');
            library = new sam.SAMCompiledDirectory(libraryPath, {}, events, 'test');
            library.isLibrary = true;

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

    describe('SAMTemplate', () => {
        
        let events = new EventEmitter();

        afterAll(() => {
            process.chdir(origin);
        });

        test('Load and build first time', async () => {
            setupDir('sam-template-SAMTemplate-Load and build first time');
            const testRoot = getRootDir(expect);
            process.chdir(testRoot);
            samconfig.load({}, '.build/root');
            samconfig.no_deploy = true;
            const sam = require('./sam-template');
            sam.setBuildRoot('.build/root');

            const projectRoot = getRootDir(expect);;
            process.chdir(projectRoot);
            const template = new sam.SAMTemplate('template.yml', events);
            try {
                await template.reload();

                expect(existsSync('.build/hash/src-library')).toBeTruthy();
                expect(existsSync('.build/hash/src-function1')).toBeTruthy();
                expect(existsSync('.build/hash/src-function2')).toBeTruthy();
            } finally {
                template.cleanup();
            }
        });

        test('Load twice', async () => {
            setupDir('sam-template-SAMTemplate-Load twice');
            const testRoot = getRootDir(expect);
            process.chdir(testRoot);
            samconfig.load({}, '.build/root');
            samconfig.no_deploy = true;
            const sam = require('./sam-template');
            sam.setBuildRoot('.build/root');
            const projectRoot = getRootDir(expect);;
            process.chdir(projectRoot);

            const template = new sam.SAMTemplate('template.yml', events);
            try {
                await template.reload();

                expect(existsSync('.build/hash/src-library')).toBeTruthy();
                expect(existsSync('.build/hash/src-function1')).toBeTruthy();
                expect(existsSync('.build/hash/src-function2')).toBeTruthy();

                const function1Dir = template.compiledDirectories['src/function1'];
                const function2Dir = template.compiledDirectories['src/function2'];
                const libDir = template.compiledDirectories['src/library'];

                await new Promise((resolve, reject) => {
                    let eventOccurred = false;
                    events.on('template-update', () => {
                        eventOccurred = true;
                        resolve();
                    });
                    touch('template.yml');

                    // Make sure we don't wait forever
                    setTimeout(() => {
                        if(!eventOccurred) {
                            reject('template-update timeout occurred');
                        }
                    }, 60000);
                });

                expect(function1Dir).toBe(template.compiledDirectories['src/function1']);
                expect(function2Dir).toBe(template.compiledDirectories['src/function2']);
                expect(libDir).toBe(template.compiledDirectories['src/library']);

                await new Promise((resolve) => {
                    let eventOccurred = false;
                    function1Dir.events.on('build-complete', () => {
                        eventOccurred = true;
                        resolve();
                    });
                    touch('src/function1/index.ts');
                    // Make sure we don't wait forever
                    setTimeout(() => {
                        if(!eventOccurred) {
                            reject('package timeout occurred');
                        }
                    }, 60000);
                });

                expect(existsSync('.build/root/src/function1/src')).toBeFalsy();
            } finally {
                template.cleanup();
            }
        });
    })
});