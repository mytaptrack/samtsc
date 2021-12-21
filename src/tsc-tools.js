const { execSync } = require('child_process');
const fs = require('./file-system');
const { resolve, relative } = require('path');
const moment = require('moment');
const { logger } = require('./logger');
const pathHashes = {};

const hashRoot = '.build/hash';
fs.mkdir(hashRoot);

function getFileSmash(path) {
    return  path.replace(/^\.\//, '').replace(/(\\|\/)/g, '-');
}
module.exports.getFileSmash = getFileSmash;

function getLastModified(path) {
    const pathlStat = fs.lstatSync(path);
    if(!pathlStat.isDirectory()) {
        return pathlStat.mtime.getTime();
    }

    const files = fs.readdirSync(path);
    const dates = files.map(x => {
        if(x == 'dist' || x == 'node_modules') {
            return;
        }
        const stats = fs.statSync(path + '/' + x);
        if(stats.isDirectory()) {
            return getLastModified(path + '/' + x);
        }
        return stats.mtime.getTime();
    }).filter(x => x? true : false);

    dates.sort();

    return dates[dates.length - 1];
}

function folderUpdated(path) {
    if(!pathHashes[path]) {
        const filePath = resolve(hashRoot, getFileSmash(path));
        if(fs.existsSync(filePath)) {
            pathHashes[path] = fs.readFileSync(filePath).toString();
        } else {
            return true;
        }
    }

    const result = moment(getLastModified(path)).toString();
    return result != pathHashes[path];
}

function writeCacheFile(sourcePath, memoryOnly) {
    pathHashes[sourcePath] = moment(getLastModified(sourcePath)).toString();
    if(!memoryOnly) {
        const filePath = resolve(hashRoot, getFileSmash(sourcePath));
        fs.writeFileSync(filePath, pathHashes[sourcePath]);
    }
}

function execOnlyShowErrors(command, options) {
    const buffer = [];
    try {
        console.log('execOnlyShowErrors', command, options);
        execSync(command, { stdio: 'pipe', ...options });
    } catch (err) {
        console.log('samtsc: exec error');
        err.stdout && console.log(err.stdout.toString());
        err.stderr && console.log(err.stderr.toString());
        console.log('samtsc: Working directory', process.cwd());
        throw new Error('Command failed');
    }
}

function compileTypescript(sourceFolder, buildRoot, options = {}, samconfig = {}) {
    if(options.library) {
        const localOutDir = resolve(sourceFolder, options.outDir || '.');
        if(options.outDir) {
            logger.info('Removing outDir');
            fs.rmdirSync(localOutDir);
        }
        const outDir = resolve(process.cwd(), `${buildRoot}/${sourceFolder}`, options.outDir || '.');
        
        console.log('samtsc: Compiling tsc', options.compileFlags, sourceFolder);
        execOnlyShowErrors(`npx tsc -d ${options.compileFlags || ''}`, { cwd: sourceFolder });
        
        console.log('samtsc: Copying output');
        fs.copyFolder(localOutDir, outDir);
        console.log('samtsc: Finished copying');
    } else {
        const outDir = resolve(process.cwd(), buildRoot, sourceFolder, options.outDir || '.');
        const sourcePath = resolve(sourceFolder);
        const transpileOnly = samconfig.transpile_only == 'true'? '--transpile-only' : '';

        const command = `npx tsc ${options.compileFlags || '' } --outDir ${outDir}` + transpileOnly;
        execOnlyShowErrors(command, { cwd: sourcePath });
    }
    console.log('samtsc: build complete', sourceFolder);
}

function findTsConfigDir(dirPath) {
    const configPath = (dirPath || '.') + '/tsconfig.json';
    if(fs.existsSync(configPath)) {
        return dirPath;
    }

    if(dirPath == '') {
        return null;
    }

    const abPath = resolve(dirPath, '..');
    const relPath = relative(process.cwd(), abPath);
    return findTsConfigDir(relPath);
}

module.exports.findTsConfigDir = findTsConfigDir;
module.exports.folderUpdated = folderUpdated;
module.exports.writeCacheFile = writeCacheFile;
module.exports.execOnlyShowErrors = execOnlyShowErrors;
module.exports.compileTypescript = compileTypescript;