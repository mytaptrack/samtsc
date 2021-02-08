// const { execSync } = require('child_process');
// const { EventEmitter } = require('events');
// const { resolve } = require('path');
// const { samconfig } = require('./sam/samconfig');
// const { existsSync, readFileSync, lstatSync, mkdir, copyFolder, touch, rmdirSync } = require('./file-system');

// const origin = process.cwd();
// const targetProject = resolve('samples/stack_layer');
// const buildRoot = '.build/root';
// const function1Path = 'src/function1';
// const function2Path = 'src/function2';
// const libraryPath = 'src/library';

// function getRootDir(exp) {
//     if(typeof exp == 'string') {
//         return resolve(origin, '.test', exp.replace(/\W/g, '-'));
//     }
//     return resolve(origin, '.test', exp.getState().currentTestName.replace(/\W/g, '-'));
// }
// const events = {
//     emit: jest.fn()
// };

// function setupEnvironment() {
//     const projectRoot = getRootDir(expect.getState().currentTestName);
//     if(existsSync(projectRoot)) {
//         rmdirSync(projectRoot);
//     }
//     mkdir(projectRoot);
//     process.chdir(projectRoot);
//     console.log(projectRoot);
//     mkdir(projectRoot);
//     copyFolder(resolve(origin, targetProject), projectRoot);
    
//     process.chdir(projectRoot);
//     mkdir('.build/root');
//     mkdir('.build/hash');
//     execSync('npm i', { stdio: 'inherit' });

//     const testRoot = getRootDir(expect);
//     process.chdir(testRoot);
//     samconfig.load({}, '.build/root');
//     const sam = require('./sam-template');
//     sam.setBuildRoot('.build/root');

//     return {
//         sam,
//         samconfig
//     };
// }

// function setupEnvironmentCompDirs() {
//     const { sam, samconfig } = setupEnvironment();

//     events.emit.mockReset();
//     const function1 = new sam.SAMCompiledDirectory(function1Path, {}, events, 'test');
//     const function2 = new sam.SAMCompiledDirectory(function2Path, {}, events, 'test');
//     const library = new sam.SAMCompiledDirectory(libraryPath, {}, events, 'test');
//     library.isLibrary = true;

//     return {
//         function1,
//         function2,
//         library,
//         sam,
//         samconfig
//     }
// }

// function cleanup(function1, function2, library) {
//     function1.cleanup();
//     function2.cleanup();
//     library.cleanup();
// }

describe('sam-template', () => {
    test('Do nothing', async () => {});
//     describe('SAMCompiledDirectory', () => {

//         afterAll(() => {
//             process.chdir(origin);
//         });

//         test('build function 1 no deploy', () => {
//             const {function1, function2, library} = setupEnvironmentCompDirs();
//             try {
//                 const projectRoot = getRootDir(expect);
//                 process.chdir(projectRoot);
//                 function1.build(null, true);
//                 expect(existsSync(`${buildRoot}/${function1.path}/index.js`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${function1.path}/index.js.map`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${function1.path}/package.json`)).toBeTruthy();
//                 expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${function2.path}/package.json`)).toBeFalsy();

//                 const pck = JSON.parse(readFileSync(`${buildRoot}/${function1.path}/package.json`));
//                 expect(Object.keys(pck.dependencies || {}).length).toBe(0);
//             } finally {
//                 cleanup(function1, function2, library);
//             }
//         }).skip();

//         test('build function 1 twice', () => {
//             const {function1, function2, library} = setupEnvironmentCompDirs();
//             try {
//                 function1.build(null, true);
//                 expect(existsSync(`.build/hash/src-function1`)).toBeTruthy();
//                 const before = lstatSync(`${buildRoot}/${function1.path}/index.js`);
//                 function1.build(null, true);
//                 const after = lstatSync(`${buildRoot}/${function1.path}/index.js`);
//                 expect(before.mtimeMs).toBe(after.mtimeMs);
//             } finally {
//                 cleanup(function1, function2, library);
//             }
//         }).skip();

//         test('build library no deploy', () => {
//             const { library, function1, function2 } = setupEnvironmentCompDirs();
//             try {
//                 library.build(null, true);

//                 // Check locally for referencing and debugging
//                 expect(existsSync(`${library.path}/dist/index.js`)).toBeTruthy();
//                 expect(existsSync(`${library.path}/dist/index.js.map`)).toBeTruthy();
//                 expect(existsSync(`${library.path}/package.json`)).toBeTruthy();

//                 // Check build dir
//                 expect(existsSync(`${buildRoot}/${library.path}/dist/index.js`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${library.path}/dist/index.js.map`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${library.path}/package.json`)).toBeTruthy();
//                 expect(existsSync(`.build/hash/src-library`)).toBeTruthy();
//                 expect(existsSync(`${buildRoot}/${function1.path}/package.json`)).toBeFalsy();

//                 const pck = JSON.parse(readFileSync(`${buildRoot}/${library.path}/package.json`));
//                 expect(Object.keys(pck.dependencies || {}).length).toBe(0);
//             } finally {
//                 cleanup(function1, function2, library);
//             }
//         }).skip();
//     });

//     describe('SAMTemplate', () => {
        
//         const events = new EventEmitter();

//         afterAll(() => {
//             process.chdir(origin);
//         });

//         test('Load and build first time', (callback) => {
//             const { sam } = setupEnvironment();
//             const template = new sam.SAMTemplate('template.yml', events);

//             template.reload()
//             .then(() => {
//                 expect(existsSync('.build/hash/src-library')).toBeTruthy();
//                 expect(existsSync('.build/hash/src-function1')).toBeTruthy();
//                 expect(existsSync('.build/hash/src-function2')).toBeTruthy();
//                 callback();
//             })
//             .finally(() => {
//                 template.cleanup();
//             });
//         }).skip();

//         test('Load twice', (callback) => {
//             const { sam } = setupEnvironment();

//             const template = new sam.SAMTemplate('template.yml', events);
//             template.reload()
//             .then(() => {
//                 expect(existsSync('.build/hash/src-library')).toBeTruthy();
//                 expect(existsSync('.build/hash/src-function1')).toBeTruthy();
//                 expect(existsSync('.build/hash/src-function2')).toBeTruthy();

//                 const function1Dir = template.compiledDirectories['src/function1'];
//                 const function2Dir = template.compiledDirectories['src/function2'];
//                 const libDir = template.compiledDirectories['src/library'];
//                 return new Promise((resolve, reject) => {
//                     let eventOccurred = false;
//                     events.on('template-update', () => {
//                         eventOccurred = true;
//                         resolve();
//                     });
//                     touch('template.yml');

//                     // Make sure we don't wait forever
//                     setTimeout(() => {
//                         if(!eventOccurred) {
//                             reject('template-update timeout occurred');
//                         }
//                     }, 60000);
//                 });
//             })
//             .then(() => {
//                 expect(function1Dir).toBe(template.compiledDirectories['src/function1']);
//                 expect(function2Dir).toBe(template.compiledDirectories['src/function2']);
//                 expect(libDir).toBe(template.compiledDirectories['src/library']);

//                 return new Promise((resolve) => {
//                     let eventOccurred = false;
//                     function1Dir.events.on('build-complete', () => {
//                         eventOccurred = true;
//                         resolve();
//                     });
//                     touch('src/function1/index.ts');
//                     // Make sure we don't wait forever
//                     setTimeout(() => {
//                         if(!eventOccurred) {
//                             reject('package timeout occurred');
//                         }
//                     }, 60000);
//                 });
//             })
//             .then(() => {
//                 expect(existsSync('.build/root/src/function1/src')).toBeFalsy();
//                 callback();
//             }).finally(() => {
//                 template.cleanup();
//             });
//         }).skip();
//     });
});
