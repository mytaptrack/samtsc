const { execSync } = require('child_process');
const fs = require('./file-system');
const path = require('path');
const moment = require('moment');
const pathHashes = {};

const hashRoot = '.build/hash';
fs.mkdir(hashRoot);

function getFileSmash(path) {
    return  hashRoot + '/' + path.replace(/^\.\//, '').replace(/(\\|\/)/g, '-');
}

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
        const filePath = getFileSmash(path);
        if(fs.existsSync(filePath)) {
            pathHashes[path] = fs.readFileSync(filePath).toString();
        } else {
            return true;
        }
    }

    const result = moment(getLastModified(path)).toString();
    return result != pathHashes[path];
}

function writeCacheFile(path, memoryOnly) {
    pathHashes[path] = moment(getLastModified(path)).toString();
    if(!memoryOnly) {
        fs.writeFileSync(getFileSmash(path), pathHashes[path]);
    }
}

function execOnlyShowErrors(command, options) {
    const buffer = [];
    try {
        execSync(command, { stdio: 'pipe', ...options });
    } catch (err) {
        console.log('samtsc: exec error');
        console.log(JSON.stringify(err));
        err.stdout && console.log(err.stdout.toString());
        err.stderr && console.log(err.stderr.toString());
        throw new Error('Command failed');
    }
}

function compileTypescript(sourceFolder, buildRoot, options = {}, samconfig = {}) {
    if(options.library) {
        const localOutDir = path.resolve(sourceFolder, options.outDir || '.');
        const outDir = path.resolve(process.cwd(), `${buildRoot}/${sourceFolder}`, options.outDir || '.');
        
        console.log('samtsc: Compiling tsc', options.compileFlags, sourceFolder);
        execOnlyShowErrors(`npx tsc -d ${options.compileFlags || ''}`, { cwd: sourceFolder });
        
        console.log('samtsc: Copying output');
        fs.copyFolder(localOutDir, outDir);
        console.log('samtsc: Finished copying');
    } else {
        const outDir = path.resolve(process.cwd(), buildRoot, sourceFolder, options.outDir || '.');
        const sourcePath = path.resolve(sourceFolder);
        const transpileOnly = samconfig.transpile_only == 'true'? '--transpile-only' : '';

        const command = `npx tsc ${options.compileFlags || '' } --outDir ${outDir}` + transpileOnly;
        execOnlyShowErrors(command, { cwd: sourcePath });
    }
    console.log('samtsc: build complete', sourceFolder);
}

module.exports.folderUpdated = folderUpdated;
module.exports.writeCacheFile = writeCacheFile;
module.exports.execOnlyShowErrors = execOnlyShowErrors;
module.exports.compileTypescript = compileTypescript;