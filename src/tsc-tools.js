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
        err.stdout && console.log(err.stdout.toString());
        err.stderr && console.log(err.stderr.toString());
        throw new Error('Command failed');
    }
}

module.exports.folderUpdated = folderUpdated;
module.exports.writeCacheFile = writeCacheFile;
module.exports.execOnlyShowErrors = execOnlyShowErrors;