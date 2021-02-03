/***************
 * This file contains file system interactions to centralize how the system interacts 
 * with the operating system to allow for more generic solutions when needed.
 */
const fs = require('fs');
const path = require('path');

function mkdir(folderPath) {
    if(!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true, force: true });
    }
}

function copyFolder(sourceDir, outDir) {
    if(!fs.existsSync(outDir)) {
        mkdir(outDir);
    }

    const results = fs.readdirSync(sourceDir, { withFileTypes: true });
    for(let f of results) {
        const sourceSub = path.resolve(sourceDir, f.name);
        const destSub = path.resolve(outDir, f.name);
        
        if(f.isDirectory()) {
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
        fs.unlinkSync(destFile);
    }

    const output = fs.createWriteStream(destFile);
    const archive = archiver('zip');

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            resolve();
        });
        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);
        archive.directory(sourceDirectory, false);
        archive.finalize();
    });
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
