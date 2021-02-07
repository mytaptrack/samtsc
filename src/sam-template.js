console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const yaml = require('js-yaml');
const { folderUpdated, writeCacheFile, execOnlyShowErrors, compileTypescript, getFileSmash } = require('./tsc-tools');
const { mkdir, copyFolder, archiveDirectory, existsSync, writeFileSync, 
    readFileSync, watch, watchFile, copyFileSync, unlinkSync } = require('./file-system');
const path = require('path');
const cfSchema = require('cloudformation-js-yaml-schema');
const aws = require('aws-sdk');
const { logger } = require('./logger');
const { samconfig } = require('./sam/samconfig');

const tempDir = "./.build/tmp";
mkdir(tempDir);

logger.loadConfig(samconfig);

console.debug = (...params) => {
    if(samconfig.debug) {
        console.log('samtsc:', ...params);
    }
}

const lambda = new aws.Lambda({ region: samconfig.region });
const cf = new aws.CloudFormation({ region: samconfig.region });
const ssm = new aws.SSM({ region: samconfig.region });

let buildRoot;
module.exports.setBuildRoot = (rootPath) => {
    buildRoot = rootPath;
}

function buildPackageJson(source) {
    console.log('samtsc: Building package.json', source);
    const pck = JSON.parse(readFileSync(`${source}/package.json`).toString());
    if(pck.dependencies) {
        Object.keys(pck.dependencies).forEach(key => {
            if(pck.dependencies[key].startsWith('file:')) {
                const subprefix = pck.dependencies[key].slice(5);
                const res = path.resolve(source, subprefix);
                pck.dependencies[key] = `file:${res}`;
            }
        });
    }

    writeFileSync(`${buildRoot}/${source}/package.json`, JSON.stringify(pck, undefined, 2));
    if(pck.dependencies) {
        execOnlyShowErrors('npm i --only=prod', { cwd: `${buildRoot}/${source}`});
    }
    console.log('samtsc: Completed package.json', source);
}

function findTsConfigDir(dirPath) {
    const configPath = dirPath + '/tsconfig.json';
    if(existsSync(configPath)) {
        return dirPath;
    }

    if(dirPath == '') {
        return null;
    }

    const abPath = path.resolve(dirPath, '..');
    const relPath = path.relative(process.cwd(), abPath);
    return findTsConfigDir(relPath);
}

class SAMCompiledDirectory {
    constructor(dirPath) {
        this.path = dirPath;
        this.events = new EventEmitter();
        console.log('samtsc: Deployment Library ', dirPath);
        this.tsconfigDir = findTsConfigDir(dirPath);
        this.loadOutDir();

        const self = this;
        this.watchHandler = watch(dirPath, { recursive: true }, (event, path) => {
            self.build(path); 
        });
    }

    cleanup() {
        this.watchHandler.close();
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
        execOnlyShowErrors(`npm i`, { cwd: this.path });
    }

    buildIfNotPresent() {
        const outDir = `${buildRoot}/${this.tsconfigDir}/${this.outDir}`;
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
                compileTypescript(this.tsconfigDir, buildRoot, { library: this.isLibrary }, samconfig);
                console.log('samtsc: build complete', this.path);
            }
            if(!filePath || filePath.indexOf('package.json') >= 0) {
                buildPackageJson(this.path);
            }
            writeCacheFile(this.path);
            if(!skipDeploy) {
                this.events.emit('build-complete');
                
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
            logger.info('preparing packaging function', this.name, tempDir, this.path);
            const zipFile = path.resolve(`${tempDir}/${getFileSmash(this.path)}.zip`);
            const buildDir = `${buildRoot}/${this.path}`;
            if(filePath == 'package.json' || !existsSync(`${buildDir}/node_modules`)) {
                const content = JSON.parse(readFileSync(path.resolve(this.path, 'package.json')));
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

class SAMLayerLib extends SAMCompiledDirectory {
    constructor(dirPath, parent, events) {
        super(dirPath);
        this.isLibrary = true;
        const self = this;
        this.events.on('build-complete', () => { events.emit('layer-change', parent);});
    }
}

class SAMLayer {
    constructor(name, properties, metadata, stackName, events) {
        this.name = name;
        this.events = events;
        this.stackName = stackName;
        this.setConfig(properties, metadata);
        console.log(`samtsc: Identified Serverless Layer: ${this.path}`);

        const self = this;
        this.handleFolderEvent(this.packagePath);
        this.watchHandler = watch(this.path, { recursive: true }, (event, filePath) => { self.handleFolderEvent(filePath); });
    }

    setConfig(properties, metadata) {
        this.path = properties.ContentUri;
        this.layerName = properties.LayerName || `${this.stackName}-${this.name}`;
        this.packageFolder = 'nodejs/';
        if(metadata && metadata.BuildMethod && metadata.BuildMethod.startsWith('nodejs')) {
            this.packageFolder = '';
        }
        this.packagePath = this.packageFolder + 'package.json';
    }

    handleFolderEvent(filePath) {
        if(filePath != this.packagePath) {
            return;
        }

        const pckFolder = path.resolve(this.path, this.packageFolder);
        if(!existsSync(this.packagePath)) {
            console.log('samtsc: nodejs/package.json does not exist');
            return;
        }
        const pckFilePath = path.resolve(pckFolder, this.packagePath);
        this.pck = JSON.parse(readFileSync(pckFilePath).toString());
        if(!this.pck.dependencies) {
            this.pck.dependencies = {};
        }

        if(this.name == samconfig.stack_reference_layer) {
            console.log('samtsc: Constructing combined dependencies');
            const rootPck = JSON.parse(readFileSync('package.json'));

            const packs = !rootPck.dependencies? [] : Object.keys(rootPck.dependencies).forEach(k => {
                let val = rootPck.dependencies[k];
                if(!val.startsWith('file:')) {
                    this.pck.dependencies[k] = val;
                    return;
                }

                val = val.slice(5);
                let abPath = path.relative(pckFolder, path.resolve(val));
                this.pck.dependencies[k] = 'file:' + abPath;
            });

            console.log('samtsc: Construction complete');
        }

        const self = this;
        this.libs = Object.values(this.pck.dependencies).filter(d => {
            if(!d.startsWith('file:')) {
                return false;
            }
            const subpath = path.resolve(this.path, this.packageFolder, d.slice(5));
            return subpath.startsWith(process.cwd());
        }).map(d => {
            console.log(d.slice(5));
            const fullPath = path.resolve(this.path, this.packageFolder, d.slice(5));
            const subpath = path.relative(process.cwd(), fullPath);
            console.log(subpath);
            return new SAMLayerLib(subpath, self, self.events);
        });

        this.libs.forEach(x => x.buildIfNotPresent());

        console.log('samtsc: constructing build directory');
        const nodejsPath = `${buildRoot}/${this.path}/${this.packageFolder}`;
        mkdir(nodejsPath);

        const pckCopy = JSON.parse(JSON.stringify(this.pck));
        if(pckCopy.dependencies) {
            Object.keys(pckCopy.dependencies).forEach(k => {
                const val = pckCopy.dependencies[k];
                if(!val.startsWith('file:')) {
                    return;
                }

                let refPath = val.slice(5);
                const abPath = path.resolve(pckFolder, refPath);
                if(abPath.startsWith(process.cwd())) {
                    refPath = path.resolve(nodejsPath, refPath);
                } else {
                    refPath = abPath;
                }
                pckCopy.dependencies[k] = refPath;
            });
        }
        writeFileSync(nodejsPath + 'package.json', JSON.stringify(pckCopy, undefined, 2));

        console.log('samtsc: installing dependencies');
        execSync('npm i --only=prod', { cwd: nodejsPath, stdio: 'inherit' });
        
        console.log('samtsc: file change ', filePath);
        this.events.emit('layer-change', this);
    }

    cleanup() {
        this.watchHandler.close();
    }
}

class SAMFunction {
    constructor(name, properties, globalUri) {
        this.name = name;
        this.setConfig(properties, globalUri);
        const self = this;
        this.listener = (zipContents) => { self.deployFunction(zipContents); };
    }

    setConfig(properties, globalUri) {
        this.path = properties.CodeUri || globalUri;
        this.layers = properties.Layers;
        this.packageForDeploy = true;

        if(properties.FunctionName) {
            if(typeof properties.FunctionName == 'string') {
                this.functionName = properties.FunctionName.trim()
            }
        }
    }

    clean() {
        if(this.compiledDirectory) {
            this.compiledDirectory.events.removeListener('package', this.listener);
        }
    }

    registerCompiledDirectory(compiledDirectory) {
        if(this.compiledDirectory == compiledDirectory) {
            return;
        }
        if(this.compiledDirectory) {
            this.compiledDirectory.events.removeListener('package', this.listener);
        }
        this.compiledDirectory = compiledDirectory;
        compiledDirectory.events.on('package', this.listener);
    }

    async deployFunction(zipContents) {
        if(samconfig.no_deploy) {
            return;
        }
        try {
            const self = this;
            console.log('samtsc: Deploying function', this.name);
            if(!this.functionName) {
                const result = await cf.listStackResources({
                    StackName: samconfig.stack_name
                }).promise();
                const resource = result.StackResourceSummaries.find(x => x.LogicalResourceId == self.name);
                if(!resource) {
                    console.log('samtsc: Could not find function name');
                    throw new Error('No function name found');
                }
                this.functionName = resource.PhysicalResourceId;
            }
            await lambda.updateFunctionCode({
                FunctionName: this.functionName,
                ZipFile: zipContents
            }).promise();

            console.log('samtsc: Function deployment complete', this.name);
        } catch (err) {
            console.log('samtsc: Function deployment FAILED', err);
        }
    }
}

function filterRefs(array) {
    if(!array) {
        return [];
    }
    return array.filter(x => x.name == 'Ref').map(x => x.data).filter(x => x? true : false);
}

class SAMTemplate {
    constructor(path, events) {
        this.path = path;
        this.events = events;
        const self = this;

        this.watchHandle = watchFile(path, (curr, prev) => {
            self.reload();
        });
    }

    cleanup() {
        this.watchHandle.stop();
        Object.values(this.compiledDirectories).forEach(x => x.cleanup());
    }

    async reload() {
        console.log('samtsc: Loading Template', this.path);
        if(!existsSync('samconfig.toml')) {
            throw new Error('No samconfig.toml found for default deployment configurations');
        }
        samconfig.save();

        const content = readFileSync(this.path).toString();
        console.log('File read');
        const template = yaml.load(content, {
            schema: cfSchema.CLOUDFORMATION_SCHEMA
        });

        if(samconfig.env_aware == 'true' && template.Parameters) {
            console.log('samtsc: environment aware turned on');
            Object.keys(template.Parameters)
            .forEach(key => {
                if(!template.Parameters[key].Default) {
                    return;
                }
                template.Parameters[key].Default = template.Parameters[key].Default.replace(/\<EnvironmentName\>/g, samconfig.environment);
            });
        }

        if(this.layers) {
            this.layers.forEach(x => x.cleanup());
        }

        let globalUri;
        if(template.Globals && template.Globals.Function && template.Globals.Function.CodeUri) {
            globalUri = template.Globals.Function.CodeUri;
        }

        const self = this;
        const layerKeys = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::LayerVersion');
        if(!this.layers) {
            this.layers = [];
        }
        layerKeys
            .forEach(key => {
                const resource = template.Resources[key];
                const existing = this.layers.find(x => x.name == key);
                if(existing) {
                    existing.setConfig(resource.Properties, resource.Metadata);
                } else {
                    const layer = new SAMLayer(key, resource.Properties, resource.Metadata, samconfig.stack_name, self.events);
                    this.layers.push(layer);
                }
            });
        this.layers = this.layers.filter(x => {
            if(layerKeys.find(y => y == x.name)) {
                return true;
            }

            x.cleanup();
            return false;
        });


        if(!this.compiledDirectories) {
            this.compiledDirectories = {};
        }
        if(!this.functions) {
            this.functions = [];
        }
        const functionKeys = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::Function');

        functionKeys.forEach(key => {
                const resource = template.Resources[key];
                let samFunc = this.functions.find(x => x.name == key);
                if(samFunc) {
                    samFunc.setConfig(resource.Properties, globalUri);
                } else {
                    samFunc = new SAMFunction(key, resource.Properties, globalUri, self.events);
                    this.functions.push(samFunc);
                }
                let compDir = this.compiledDirectories[samFunc.path];
                if(!compDir) {
                    console.log('samtsc: Constructing directory to compile', samFunc.path);
                    compDir = new SAMCompiledDirectory(samFunc.path);
                    compDir.installAtLeastOnce();
                    compDir.build();
                    this.compiledDirectories[samFunc.path] = compDir;
                }
                samFunc.registerCompiledDirectory(compDir);
            });

        this.functions = this.functions.filter(x => {
            const result = functionKeys.find(y => y == x.name);
            if(result) {
                return true;
            }

            x.clean();
            return false;
        });


        Object.values(this.compiledDirectories).forEach(x => {
            if(!this.functions.find(y => y.path == x.path)) {
                x.cleanup();
            }
        });


        if(samconfig.parm_layer == 'true') {
            const layerRefs = [];
            if(template.Globals && template.Globals.Function && template.Globals.Function.Layers) {
                console.log('samtsc: Checking global function values');
                layerRefs.push(...filterRefs(template.Globals.Function.Layers));
            }
            this.functions.forEach(f => {
                layerRefs.push(...filterRefs(f.layers));
            });

            const paramNames = Object.keys(template.Parameters);
            const paramRefs = layerRefs.filter(r => paramNames.find(x => x == r) && template.Parameters[r].Type == 'AWS::SSM::Parameter::Value<String>');

            if(paramRefs.length > 0) {
                const paramResults = await ssm.getParameters({
                    Names: paramRefs.map(p => template.Parameters[p].Default)
                }).promise();

                paramRefs.forEach(key => {
                    const parm = template.Parameters[key];
                    const paramValue = paramResults.Parameters.find(x => x.Name == parm.Default);
                    if(paramValue) {
                        parm.Default = paramValue.Value;
                        parm.Type = 'String';
                    }
                });
            }
        }

        const buildPath = `${buildRoot}/${this.path}`;
        if(existsSync(buildPath)) {
            unlinkSync(buildPath);
        }
        console.log('samtsc: Writing file', buildPath)
        writeFileSync(buildPath, yaml.dump(template, { schema: cfSchema.CLOUDFORMATION_SCHEMA}));
        this.events.emit('template-update', this);
    }
}
module.exports.SAMTemplate = SAMTemplate;

class SAMFramework {
    constructor(path, buildRootDir, flags) {
        console.log('samtsc: Loading Framework');
        const self = this;
        samconfig.load(flags, buildRootDir);

        this.events = new EventEmitter();
        buildRoot = buildRootDir;
        this.buildRoot = buildRoot;
        this.path = path;
    }

    async load() {
        this.template = new SAMTemplate(this.path, this.events);
        await this.template.reload();
        this.template.layers.forEach(f => {
            try {
                if(f.libs) {
                    console.log('samtsc: Building', f.path);
                    f.libs.forEach(l => {
                        console.log('samtsc: Building', l.path);
                        l.build(undefined, true);
                    });
                }
            } catch (err) {
                console.log('samtsc: could not install or compile', f.path);
                console.log(err);
            }
        });

        if(samconfig.skip_init_deploy != 'true') {
            this.templateUpdated();
        }

        const self = this;
        this.events.on('layer-change', (source) => { self.templateUpdated(source) });
        this.events.on('template-update', (source) => { self.templateUpdated(); } )
    }

    templateUpdated() {
        console.log('samtsc: Building SAM deployment');
        execSync(`sam build`, { cwd: buildRoot, stdio: 'inherit' });
        console.log('samtsc: Completed building SAM deployment, deploying with SAM');
        if (samconfig.build_only != 'true') {
            let parameters = '--no-fail-on-empty-changeset --no-confirm-changeset';
            if(samconfig.base_stack) {
                parameters = `${parameters} --parameter-overrides StackName=${samconfig.base_stack} EnvironmentTagName=${samconfig.environment}`;
            }

            execSync(`sam deploy ${parameters}`, { cwd: buildRoot, stdio: 'inherit' });
        }
    }

    deployChange(source, skipDeploy) {
        try {
            console.log('samtsc: Building SAM Resource', source.name);
            execOnlyShowErrors(`sam build ${source.name}`, { cwd: this.buildRoot });
            console.log('samtsc: Deploying SAM Resource', source.name);
            execSync(`sam deploy --s3-bucket ${samconfig.s3_bucket} --s3-prefix ${samconfig.s3_prefix} --no-confirm-changeset`, { cwd: this.buildRoot, stdio: 'inherit' });

            if(this.mode == 'publish') {
                console.log('samtsc: Deploying');
                execOnlyShowErrors(`sam deploy`, { cwd: this.buildRoot });
            }
            console.log('samtsc: SAM Build Complete')
        } catch (err) {
            return;
        }
    }
}

module.exports.SAMFramework = SAMFramework;