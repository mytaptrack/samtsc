const tsc = require('./tsc-tools');
const path = require('path');
const fs = require('./file-system');
const { execSync } = require('child_process');

const sampleProjectRoot = 'samples/stack_layer'
const function1Path = 'src/function1';
const libPath = 'src/library';
const buildRoot = '.build/root';

const origin = process.cwd();

describe('tsc-tools', () => {
    let projectRoot;
    beforeEach(() => {
        projectRoot = path.resolve(origin + '/.test/' + new Date().getTime());
        console.log(projectRoot);
        fs.mkdir(projectRoot);
        fs.copyFolder(sampleProjectRoot, projectRoot);
        
        process.chdir(projectRoot);
        execSync('npm i', { stdio: 'inherit' });
        
        fs.mkdir(path.resolve(projectRoot, buildRoot));
    });
    afterEach(() => {
        process.chdir(origin);
    })

    test('Compile function', () => {
        const fullPath = path.resolve(function1Path);
        console.log(fullPath, fs.existsSync(fullPath));
        tsc.compileTypescript(function1Path, '.build/root', {}, {});

        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js.map`)).toBeTruthy();
    });

    test('Compile library', () => {
        const fullPath = path.resolve(libPath);
        console.log(libPath, fs.existsSync(libPath));
        tsc.compileTypescript(libPath, '.build/root', { isLibrary: true }, {});

        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js.map`)).toBeTruthy();
    });
});