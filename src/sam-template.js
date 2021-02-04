console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const yaml = require('js-yaml');
const { folderUpdated, writeCacheFile, execOnlyShowErrors } = require('./tsc-tools');
const { mkdir, copyFolder, archiveDirectory, existsSync, writeFileSync, 
    readFileSync, watch, watchFile, copyFileSync, unlinkSync } = require('./file-system');
const path = require('path');
const cfSchema = require('cloudformation-js-yaml-schema');
const aws = require('aws-sdk');

const tempDir = "./.build/tmp";
mkdir(tempDir);

let buildFlags = {};

let stackeryConfig;
if(process.env.stackery_config) {
    console.log(process.env);
    const content = process.env.stackery_config.indexOf('\\"') >= 0? JSON.parse("\"" + process.env.stackery_config + "\"") : process.env.stackery_config;
    stackeryConfig = JSON.parse(content);
    if(stackeryConfig.awsProfile) {
        let awsFilePath;
        if(!existsSync('~/.aws')) {
            if(existsSync(`/mnt/c/Users/${process.env.USER}/.aws`)) { // Windows wcl
                awsFilePath = `/mnt/c/Users/${process.env.USER}/.aws/credentials`;
            } else if(existsSync(`/c/Users/${process.env.USER}/.aws`)) { // Gitbash
                awsFilePath = `/c/Users/${process.env.USER}/.aws/credentials`;
            }
        }
        var credentials = new aws.SharedIniFileCredentials({profile: stackeryConfig.awsProfile, filename: awsFilePath });
        aws.config.credentials = credentials;
    }
}

class SAMConfig {
    constructor() {
        this.load();
    }

    save() {
        writeFileSync(`${buildRoot}/samconfig.toml`,
        [
            'version=0.1',
            '[default.deploy.parameters]',
            ...Object.keys(this).map(key => `${key} = "${this[key]}"`)
        ].join('\n')
        );
    }

    load() {
        if(!existsSync('samconfig.toml')) {
            console.error('samtsc: no sam config file found');
            return;
        }
        const parts = readFileSync('samconfig.toml').toString().split('\n');

        const self = this;
        Object.keys(buildFlags).forEach(key => {
            self[key] = buildFlags[key];
        });
        parts.forEach(x => {
            const index = x.indexOf('=');
            if(index < 0) {
                return;
            }
            const left = x.slice(0, index).trim();
            if(left == 'version') {
                return;
            }
            const right = x.slice(index + 1);

            const firstIndex = right.indexOf('\"');
            const lastIndex = right.lastIndexOf('\"');
            this[left] = right.slice(firstIndex + 1, lastIndex);
            console.log('toml:', left, this[left]);
        });

        if(stackeryConfig) {
            this.base_stack = stackeryConfig.stackName;
            this.environment = stackeryConfig.environmentName;
            this.region = stackeryConfig.region;
            this.s3_bucket = stackeryConfig.s3BucketName;
            this.stack_name = stackeryConfig.cloudFormationStackName;
        }

        if(!this.stack_name) {
            if(this.base_stack && this.environment) {
                this.stack_name = `${this.base_stack}-${this.environment}`;
            } else {
                console.log('samtsc: Could not find or construct stack name');
                process.exit(1);
                throw new Error('Could not find stack name');
            }
        }
    }
}

samconfig = new SAMConfig();

const lambda = new aws.Lambda({ region: samconfig.region });
const cf = new aws.CloudFormation({ region: samconfig.region });
const ssm = new aws.SSM({ region: samconfig.region });

let buildRoot;

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

    const parts = dirPath.split(/(\\|\/)/g);
    return findTsConfigDir(parts.slice(0, parts.length - 2).join('/'));
}

class SAMCompiledDirectory {
    constructor(dirPath, eventObject, events, notificationType) {
        this.path = dirPath;
        this.eventObject = eventObject;
        this.events = events;
        console.log('samtsc: Deployment Library ', dirPath);
        this.tsconfigDir = findTsConfigDir(dirPath);
        this.loadOutDir();

        const self = this;
        this.watchHandler = watch(dirPath, { recursive: true }, (event, path) => { self.build(path); });
        this.notificationType = notificationType;
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

    installDependencies() {
        execOnlyShowErrors(`npm i`, { cwd: this.path });
    }

    buildIfNotPresent() {
        const outDir = `${buildRoot}/${this.tsconfigDir}/${this.outDir}`;
        if(!existsSync(outDir)) {
            this.build(undefined, true);
        }
    }

    build(filePath, skipDeploy) {
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

            let compileFlags = this.isLibrary? '-d' : '';

            if(this.tsconfigDir) {
                console.log('samtsc: building path ', this.path);
                if(this.isLibrary) {
                    const localOutDir = path.resolve(this.tsconfigDir, this.outDir || '.');
                    const outDir = path.resolve(process.cwd(), `${buildRoot}/${this.tsconfigDir}`, this.outDir || '.');
                    
                    console.log('samtsc: Compiling tsc', compileFlags, this.path);
                    execOnlyShowErrors(`npx tsc ${compileFlags}`, { cwd: this.path });
                    
                    console.log('samtsc: Copying output');
                    copyFolder(localOutDir, outDir);
                    console.log('samtsc: Finished copying');
                } else {
                    const outDir = path.resolve(process.cwd(), buildRoot, this.tsconfigDir, this.outDir || '.');
                    const transpileOnly = samconfig.transpile_only == 'true'? '--transpile-only' : '';

                    execOnlyShowErrors(`npx tsc ${compileFlags} --outDir ${outDir}` + transpileOnly, { cwd: this.path });
                }
                console.log('samtsc: build complete', this.path);
            }
            if(!filePath || filePath.indexOf('package.json') >= 0) {
                buildPackageJson(this.path);
            }
            writeCacheFile(this.path);
            if(!skipDeploy) {
                if(this.eventObject) {
                    this.events.emit(this.notificationType, this.eventObject);
                }
                if(this.deploy && filePath) {
                    this.deploy(filePath);
                }
            }
        } catch (err) {
            console.log(err);
            throw err;
        }
    }
}

class SAMLayerLib extends SAMCompiledDirectory {
    constructor(dirPath, parent, events) {
        super(dirPath, parent, events, 'layer-change');
        this.isLibrary = true;
    }
}

class SAMLayer {
    constructor(name, properties, metadata, stackname, events) {
        this.name = name;
        this.events = events;
        this.path = properties.ContentUri;
        this.layerName = properties.LayerName || `${stackname}-${name}`;
        this.packageFolder = 'nodejs/';
        if(metadata && metadata.BuildMethod && metadata.BuildMethod.startsWith('nodejs')) {
            this.packageFolder = '';
        }
        this.packagePath = this.packageFolder + 'package.json';

        console.log(`samtsc: Identified Serverless Layer: ${this.path}`);
        
        const self = this;
        this.handleFolderEvent(this.packagePath);
        this.watchHandler = watch(this.path, { recursive: true }, (event, filePath) => { self.handleFolderEvent(filePath); });
    }

    handleFolderEvent(filePath) {
        if(filePath != this.packagePath) {
            return;
        }
        const packPath = `${this.path}/${filePath}`;
        if(!existsSync(packPath)) {
            console.log('samtsc: nodejs/package.json does not exist');
            return;
        }
        this.pck = JSON.parse(readFileSync(packPath).toString());
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
                const abPath = path.resolve(val);
                this.pck.dependencies[k] = 'file:' + path.relative(`${this.path}/${this.packageFolder}`, abPath);
            });

            console.log('samtsc: Construction complete', JSON.stringify(this.pck, undefined, 2));
        }

        const self = this;
        this.libs = Object.values(this.pck.dependencies).filter(d => {
            if(!d.startsWith('file:')) {
                return false;
            }
            const subpath = path.resolve(`${this.path}/${this.packageFolder}`, d.slice(5));
            return subpath.startsWith(process.cwd());
        }).map(d => {
            console.log(d.slice(5));
            const fullPath = path.resolve(`${this.path}/${this.packageFolder}`, d.slice(5));
            const subpath = path.relative(process.cwd(), fullPath);
            console.log(subpath);
            return new SAMLayerLib(subpath, self, self.events);
        });

        this.libs.forEach(x => x.buildIfNotPresent());

        console.log('samtsc: constructing build directory');
        const nodejsPath = `${buildRoot}/${this.path}/${this.packageFolder}`;
        mkdir(nodejsPath);
        writeFileSync(nodejsPath + 'package.json', JSON.stringify(this.pck, undefined, 2));

        console.log('samtsc: installing dependencies');
        execSync('npm i --only=prod', { cwd: nodejsPath, stdio: 'inherit' });
        
        console.log('samtsc: file change ', filePath);
        this.events.emit('layer-change', this);
    }

    cleanup() {
        this.watchHandler.close();
    }
}

class SAMFunction extends SAMCompiledDirectory {
    constructor(name, properties, stackname, globalUri, events) {
        super(properties.CodeUri || globalUri, undefined, events, '');
        this.eventObject = this;
        this.name = name;
        this.layers = properties.Layers;

        if(properties.FunctionName) {
            if(typeof properties.FunctionName == 'string') {
                this.functionName = properties.FunctionName.trim()
            }
        }
        this.deploy = this.deployFunction;
    }

    async deployFunction(filePath) {
        try {
            console.log('samtsc: Packaging function', this.name);
            const zipFile = path.resolve(`${tempDir}/${this.functionName || this.name}.zip`);
            const buildDir = `${buildRoot}/${this.path}`;
            if(filePath == 'package.json' || !existsSync(`${buildDir}/node_modules`)) {
                const content = JSON.parse(readFileSync(path.resolve(this.path, 'package.json')));
                if(content.dependencies && Object.keys(content.dependencies)) {
                    console.log('samtsc: Updating dependencies');
                    execOnlyShowErrors('npm i --only=prod', { cwd: `${buildDir}`})        
                }
            }

            console.log('samtsc: packaging up function');
            console.log(`${buildDir}`);
            
            await archiveDirectory(zipFile, `${buildDir}`);
            const zipContents = readFileSync(zipFile);
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

        watchFile(path, (curr, prev) => {
            self.reload();
        });
    }

    async reload() {
        console.log('samtsc: Loading Template', this.path);
        if(!existsSync('samconfig.toml')) {
            throw new Error('No samconfig.toml found for default deployment configurations');
        }
        samconfig.save();

        const content = readFileSync(this.path);
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
        if(this.functions) {
            this.functions.forEach(x => x.cleanup());
        }

        let globalUri;
        if(template.Globals && template.Globals.Function && template.Globals.Function.CodeUri) {
            globalUri = template.Globals.Function.CodeUri;
        }

        const self = this;
        const layerKeys = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::LayerVersion');
        this.layers = layerKeys
            .map(key => {
                const resource = template.Resources[key];
                return new SAMLayer(key, resource.Properties, resource.Metadata, samconfig.stack_name, self.events);
            });

        this.functions = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::Function')
            .map(key => {
                const resource = template.Resources[key];
                return new SAMFunction(key, resource.Properties, samconfig.stack_name, globalUri, self.events);
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
        writeFileSync(buildPath, yaml.dump(template, { schema: cfSchema.CLOUDFORMATION_SCHEMA}));
        this.events.emit('template-update', this);
    }
}

class SAMFramework {
    constructor(path, buildRootDir, flags) {
        console.log('samtsc: Loading Framework');
        const self = this;
        buildFlags = flags;
        samconfig.load();

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

        this.template.functions.forEach(f => {
            try {
                console.log('samtsc: Building', f.path);
                execOnlyShowErrors('npm i', { cwd: f.path }, { });
                f.build(undefined, true);
            } catch (err) {
                console.log('samtsc: could not install or compile ', f.path);
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
            execSync('sam deploy --no-fail-on-empty-changeset --no-confirm-changeset', { cwd: buildRoot, stdio: 'inherit' });
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