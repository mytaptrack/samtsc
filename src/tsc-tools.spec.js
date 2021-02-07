const tsc = require('./tsc-tools');
const path = require('path');
const fs = require('./file-system');
const { execSync } = require('child_process');
const { getUniqueValue } = require('./sam-template.spec');

const sampleProjectRoot = 'samples/stack_layer'
const function1Path = 'src/function1';
const libPath = 'src/library';
const buildRoot = '.build/root';

const origin = process.cwd();
function getRootDir(exp) {
    if(typeof exp == 'string') {
        return path.resolve(origin, '.test', exp.replace(/\W/g, '-'));
    }
    return path.resolve(origin, '.test', exp.getState().currentTestName.replace(/\W/g, '-'));
}

function setupDir() {
    projectRoot = getRootDir(expect.getState().currentTestName);
    if(fs.existsSync(projectRoot)) {
        fs.rmdirSync(projectRoot);
    }
    console.log(projectRoot);
    fs.mkdir(projectRoot);
    fs.copyFolder(path.resolve(origin, sampleProjectRoot), projectRoot);
    
    process.chdir(projectRoot);
    execSync('npm i', { stdio: 'inherit' });
    
    fs.mkdir(path.resolve(projectRoot, buildRoot));
    process.chdir(origin);

}

describe('tsc-tools', () => {
    beforeAll(() => {
    });
    afterEach(() => {
        process.chdir(origin);
    });

    test('Compile function', () => {
        setupDir();
        const projectRoot = getRootDir(expect);
        process.chdir(projectRoot);
        const fullPath = path.resolve(function1Path);
        console.log(fullPath, fs.existsSync(fullPath));
        tsc.compileTypescript(function1Path, '.build/root', {}, {});

        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${function1Path}/index.js.map`)).toBeTruthy();
    });

    test('Compile library', () => {
        setupDir();
        const projectRoot = getRootDir(expect);
        process.chdir(projectRoot);
        const fullPath = path.resolve(libPath);
        console.log(libPath, fs.existsSync(libPath));
        tsc.compileTypescript(libPath, '.build/root', { isLibrary: true }, {});

        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js`)).toBeTruthy();
        expect(fs.existsSync(`${buildRoot}/${libPath}/index.js.map`)).toBeTruthy();
    });
});
