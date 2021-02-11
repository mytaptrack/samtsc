const { watch, readFileSync, writeFileSync, existsSync, archiveDirectory } = require('../file-system');
const { execOnlyShowErrors, folderUpdated, compileTypescript, findTsConfigDir, writeCacheFile, getFileSmash } = require('../tsc-tools');
const { logger } = require('../logger');
const { EventEmitter } = require('events');
const { resolve } = require('path');

function buildPackageJson(source, buildRoot) {
    console.log('samtsc: Building package.json', source);
    const pck = JSON.parse(readFileSync(`${source}/package.json`).toString());
    if(pck.dependencies) {
        Object.keys(pck.dependencies).forEach(key => {
            if(pck.dependencies[key].startsWith('file:')) {
                const subPrefix = pck.dependencies[key].slice(5);
                const res = resolve(source, subPrefix);
                pck.dependencies[key] = `file:${res}`;
            }
        });
    }

    writeFileSync(`${buildRoot}/${source}/package.json`, JSON.stringify(pck, undefined, 2));
    if(pck.dependencies && Object.keys(pck.dependencies).length > 0) {
        execOnlyShowErrors('npm i --only=prod', { cwd: `${buildRoot}/${source}`});
    }
    console.log('samtsc: Completed package.json', source);
}

class SAMCompiledDirectory {
    constructor(dirPath, samconfig, buildRoot, tempDir = '.build/tmp') {
        this.path = dirPath;
        this.samconfig = samconfig;
        this.buildRoot = buildRoot;
        this.tempDir = tempDir;
        this.events = new EventEmitter();
        console.log('samtsc: Deployment Library ', dirPath);
        this.tsconfigDir = findTsConfigDir(dirPath);
        this.loadOutDir();
    }

    cleanup() {
    }

    fileEvent(filePath) {
        if(filePath.startsWith('package.json.')) {
            return;
        }
        console.log('samtsc: File event occurred', filePath);
        this.build(filePath); 
    }

    loadOutDir() {
        if(this.tsconfigDir) {
            console.log('samtsc: Loading tsconfig in', this.tsconfigDir);
            const tsconfigPath = `${this.tsconfigDir}/tsconfig.json`;
            const tsconfig = JSON.parse(readFileSync(tsconfigPath).toString());
            if(tsconfig) {
                if(tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.outDir) {
                    this.outDir = tsconfig.compilerOptions.outDir;
                }

                if(this.outDir) {
                    if(!tsconfig.exclude) {
                        tsconfig.exclude = [];
                    }

                    let needsSaving = false;
                    if(!tsconfig.exclude.find(x => x == `${this.outDir}/**/*`)) {
                        tsconfig.exclude.push(`${this.outDir}/**/*`);
                        needsSaving = true;
                    }
                    if(!tsconfig.exclude.find(x => x == `node_modules/**/*`)) {
                        tsconfig.exclude.push(`node_modules/**/*`);
                        needsSaving = true;
                    }

                    if(needsSaving) {
                        writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
                    }
                }
            }
        }
        if(!this.outDir) {
            this.outDir = '';
        }
    }

    installAtLeastOnce() {
        if(this.alreadyInstalled) {
            return;
        }
        this.installDependencies();
    }

    installDependencies() {
        console.log('samtsc: installing dependencies', this.path);
        const content = JSON.parse(readFileSync(this.path + '/package.json'));
        if(content.dependencies && Object.keys(content.dependencies).length > 0) {
            execOnlyShowErrors(`npm i`, { cwd: this.path });
        }
    }

    buildIfNotPresent() {
        const outDir = `${this.buildRoot}/${this.tsconfigDir}/${this.outDir}`;
        if(!existsSync(outDir)) {
            this.build(undefined, true);
        }
    }

    build(filePath, skipDeploy) {
        logger.debug('Starting build');
        if(filePath && this.outDir && (filePath.startsWith(this.outDir) || filePath.indexOf('node_modules') >= 0)) {
            return;
        }

        if(!folderUpdated(this.path)) {
            // console.log('samtsc: No build needed');
            // TODO: Figure out if this scenario is a second call of the same compile or a separate function
            // needing to be deployed
            // if(this.deploy && filePath) {
            //     this.deploy(filePath);
            // }
            return;
        }

        try {
            filePath && console.log('samtsc: File changed ', filePath);

            if((!filePath && !existsSync(this.path + '/node_modules')) || (filePath && filePath.indexOf('package.json') >= 0)) {
                this.installDependencies();
            }

            if(this.tsconfigDir) {
                console.log('samtsc: building path ', this.path);
                compileTypescript(this.tsconfigDir, this.buildRoot, { library: this.isLibrary }, this.samconfig);
                console.log('samtsc: build complete', this.path);
            }
            if(!filePath || filePath.indexOf('package.json') >= 0) {
                buildPackageJson(this.path, this.buildRoot);
            }
            writeCacheFile(this.path);
            this.events.emit('build-complete');

            if(!skipDeploy) {
                if(filePath) {
                    this.package(filePath);
                }
            }
        } catch (err) {
            console.debug(err);
            throw err;
        }
    }

    async package(filePath) {
        try {
            logger.info('preparing packaging function', this.name, this.tempDir, this.path);
            const zipFile = resolve(`${this.tempDir}/${getFileSmash(this.path)}.zip`);
            const buildDir = `${this.buildRoot}/${this.path}`;
            if(filePath == 'package.json' || !existsSync(`${buildDir}/node_modules`)) {
                const content = JSON.parse(readFileSync(resolve(this.path, 'package.json')));
                if(content.dependencies && Object.keys(content.dependencies)) {
                    logger.info('samtsc: Updating dependencies');
                    execOnlyShowErrors('npm i --only=prod', { cwd: `${buildDir}`})        
                }
            }

            logger.info('packaging up function');
            logger.debug(buildDir);
            
            await archiveDirectory(zipFile, buildDir);
            const zipContents = readFileSync(zipFile);

            this.events.emit('package', zipContents);

            logger.success('packaging complete', this.name);
        } catch (err) {
            logger.error('packaging FAILED', err);
        }
    }
}
module.exports.SAMCompiledDirectory = SAMCompiledDirectory;
