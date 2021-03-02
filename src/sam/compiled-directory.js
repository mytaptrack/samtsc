const { watch, readFileSync, writeFileSync, existsSync, archiveDirectory, mkdir, syncFolder } = require('../file-system');
const { execOnlyShowErrors, folderUpdated, compileTypescript, findTsConfigDir, writeCacheFile, getFileSmash } = require('../tsc-tools');
const { logger } = require('../logger');
const { EventEmitter } = require('events');
const { resolve, relative } = require('path');

function buildPackageJson(source, buildRoot) {
    logger.info('samtsc: Building package.json', source);
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

    mkdir(`${buildRoot}/${source}`);
    writeFileSync(`${buildRoot}/${source}/package.json`, JSON.stringify(pck, undefined, 2));
    if(pck.dependencies && Object.keys(pck.dependencies).length > 0) {
        execOnlyShowErrors('npm i --only=prod', { cwd: `${buildRoot}/${source}`});
    }
    logger.info('samtsc: Completed package.json', source);
}

class SAMCompiledDirectory {
    constructor(dirPath, samconfig, buildRoot, tempDir = '.build/tmp') {
        this.path = dirPath;
        this.samconfig = samconfig;
        this.buildRoot = buildRoot;
        this.tempDir = tempDir;
        this.events = new EventEmitter();
        logger.success('Deployment Library ', dirPath);
        const parent = findTsConfigDir(dirPath);

        if(!existsSync(this.path)) {
            logger.error('CodeUri directory does not exist', dirPath);
            throw new Error('Directory does not exist');
        }
        if(parent != this.path) {
            if(parent == null) {
                logger.error('No parent tsconfig.json found');
                throw new Error('No parent tsconfig.json found')
            }
            logger.warn('Building tsconfig.json for', dirPath);
            writeFileSync(`${this.path}/tsconfig.json`, JSON.stringify({ extends: relative(dirPath, parent || '.') + '/tsconfig.json' }, undefined, 2));
        }
        if(!existsSync(`${dirPath}/package.json`)) {
            logger.warn('Building package.json for', dirPath);
            writeFileSync(`${this.path}/package.json`, JSON.stringify({ name: 'lambda-function', version: '1.0.0' }, undefined, 2));
        }
        this.tsconfigDir = this.path;

        this.loadOutDir();
    }

    cleanup() {
    }

    fileEvent(filePath) {
        if(filePath.startsWith('package.json.')) {
            return;
        }
        logger.warn('File event occurred', filePath);
        this.build(filePath); 
    }

    loadOutDir() {
        logger.info('Loading tsconfig in', this.tsconfigDir);
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
        logger.info('installing dependencies', this.path);
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

        if(!folderUpdated(this.path) && 
            existsSync(resolve(this.buildRoot, this.path, 'package.json')) &&
            (!this.outDir || existsSync(resolve(this.path, this.outDir)))) {
            // console.log('samtsc: No build needed');
            // TODO: Figure out if this scenario is a second call of the same compile or a separate function
            // needing to be deployed
            // if(this.deploy && filePath) {
            //     this.deploy(filePath);
            // }
            return;
        }

        try {
            filePath && logger.info('File changed ', filePath);

            if((!filePath && !existsSync(this.path + '/node_modules')) || (filePath && filePath.indexOf('package.json') >= 0)) {
                this.installDependencies();
            }

            syncFolder(this.path, resolve(this.buildRoot, this.path), ['node_modules', '.ts', 'package.json', 'tsconfig.json']);

            if(this.tsconfigDir) {
                logger.info('building path ', this.path);
                compileTypescript(this.tsconfigDir, this.buildRoot, { library: this.isLibrary }, this.samconfig);
                logger.success('build complete', this.path);
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
                    logger.info('Updating dependencies');
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
