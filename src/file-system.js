/***************
 * This file contains file system interactions to centralize how the system interacts 
 * with the operating system to allow for more generic solutions when needed.
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { logger } = require('./logger');

function mkdir(folderPath) {
    if(!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true, force: true });
    }
}

function rmdir(sourceDir) {
    if(!fs.existsSync(sourceDir)) {
        return;
    }

    const results = fs.readdirSync(sourceDir, { withFileTypes: true });
    for(let f of results) {
        const sourceSub = path.resolve(sourceDir, f.name);
        
        if(f.isDirectory()) {
            rmdir(sourceSub);
        } else {
            if(fs.existsSync(sourceSub)) {
                fs.unlinkSync(sourceSub);
            }
        }
    }
    fs.rmdirSync(sourceDir);
}

function syncFolder(sourceDir, outDir, excludeArray = []) {
    if(!fs.existsSync(outDir) || excludeArray.find(x => sourceDir.endsWith(x))) {
        mkdir(outDir);
    }

    const results = fs.readdirSync(sourceDir, { withFileTypes: true });
    for(let f of results) {
        if(excludeArray.find(x => f.name.endsWith(x))) {
            continue;
        }
        const sourceSub = path.resolve(sourceDir, f.name);
        const destSub = path.resolve(outDir, f.name);
        
        if(f.isDirectory() || f.isSymbolicLink()) {
            copyFolder(sourceSub, destSub);
        } else {
            const sourceStat = fs.lstatSync(sourceSub);
            const destStat = fs.existsSync(destSub)? fs.lstatSync(destSub) : {};
            if(sourceStat.size === destStat.size && sourceStat.mtimeMs === destStat.mtimeMs) {
                continue;
            }
            if(fs.existsSync(destSub)) {
                fs.unlinkSync(destSub);
            }
            fs.copyFileSync(sourceSub, destSub);
            fs.utimesSync(destSub, sourceStat.atime, sourceStat.mtime);
        }
    }
}

function copyFolder(sourceDir, outDir, excludeArray = []) {
    if(!fs.existsSync(outDir) || excludeArray.find(x => sourceDir.endsWith(x))) {
        mkdir(outDir);
    }

    const results = fs.readdirSync(sourceDir, { withFileTypes: true });
    for(let f of results) {
        if(excludeArray.find(x => f.name.endsWith(x))) {
            continue;
        }
        const sourceSub = path.resolve(sourceDir, f.name);
        const destSub = path.resolve(outDir, f.name);
        
        if(f.isDirectory() || f.isSymbolicLink()) {
            copyFolder(sourceSub, destSub);
        } else {
            if(fs.existsSync(destSub)) {
                fs.unlinkSync(destSub);
            }
            fs.copyFileSync(sourceSub, destSub);
        }
    }
}


function archiveDirectory(destFile, sourceDirectory) {
    if(fs.existsSync(destFile)) {
        logger.debug('Deleting dest file', destFile);
        fs.unlinkSync(destFile);
    }

    logger.debug('Creating streams', destFile, sourceDirectory);
    const output = fs.createWriteStream(destFile);
    const archive = archiver('zip');

    return new Promise((resolve, reject) => {
        logger.debug('Setting up event listeners');
        output.on('close', () => {
            logger.debug('closing file', destFile);
            resolve();
        });
        archive.on('error', (err) => {
            logger.error(err);
            reject(err);
        });

        logger.debug('Piping zip output');
        archive.pipe(output);
        archive.directory(sourceDirectory, false);

        logger.debug('Finalizing zip file');
        archive.finalize();
    });
}

function touch(filename) {
    const time = new Date();
    fs.utimesSync(filename, time, time);
}

module.exports.mkdir = mkdir;
module.exports.copyFolder = copyFolder;
module.exports.archiveDirectory = archiveDirectory;
module.exports.existsSync = fs.existsSync;
module.exports.writeFileSync = fs.writeFileSync;
module.exports.readFileSync = fs.readFileSync;
module.exports.watch = fs.watch;
module.exports.watchFile = fs.watchFile;
module.exports.statSync = fs.statSync;
module.exports.copyFileSync = fs.copyFileSync;
module.exports.unlinkSync = fs.unlinkSync;
module.exports.lstatSync = fs.lstatSync;
module.exports.readdirSync = fs.readdirSync;
module.exports.rmdirSync = rmdir;
module.exports.touch = touch;
module.exports.symlinkSync = fs.symlinkSync;
module.exports.syncFolder = syncFolder;