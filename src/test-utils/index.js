const { resolve } = require('path');
const { execSync } = require('child_process');
const { existsSync, mkdir, rmdirSync, copyFolder } = require('../file-system');
const { logger } = require('../logger');
logger.loadConfig({});

const origin = process.env.TEST_ORIGIN || process.cwd();
process.env.TEST_ORIGIN = origin;
const targetProject = resolve('samples/stack_layer');
const buildRoot = '.build/root';

function getRootDir() {
    return resolve(origin, '.test', expect.getState().currentTestName.replace(/\W/g, '-'));
}

function setupTestEnvironment() {
    const projectRoot = getRootDir();
    if(existsSync(projectRoot)) {
        rmdirSync(projectRoot);
    }
    mkdir(projectRoot);
    process.chdir(projectRoot);
    console.log(projectRoot);
    mkdir(projectRoot);
    copyFolder(resolve(origin, targetProject), projectRoot);
    
    process.chdir(projectRoot);
    mkdir(buildRoot);
    mkdir('.build/hash');
    mkdir('.build/root');
    mkdir('.build/tmp');
    execSync('npm i', { stdio: 'inherit' });
    return projectRoot;
}

module.exports.getRootDir = getRootDir;
module.exports.setupTestEnvironment = setupTestEnvironment;
module.exports.origin = origin;
module.exports.buildRoot = buildRoot;