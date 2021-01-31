console.log('samtsc: Loading SAM Framework Tools');
const { exec, execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const yaml = require('js-yaml');
const { folderUpdated, writeCacheFile, execOnlyShowErrors } = require('./tsc-tools');
const path = require('path');
const cfSchema = require('cloudformation-js-yaml-schema');
const aws = require('aws-sdk');

const tempDir = "./.build/tmp";
execOnlyShowErrors(`bash -c "mkdir -p ${tempDir}"`);
let buildFlags = {};

class SAMConfig {
    constructor() {
        this.load();
    }

    save() {
        fs.writeFileSync(`${buildRoot}/samconfig.toml`,
        [
            'version=0.1',
            '[default.deploy.parameters]',
            ...Object.keys(this).map(key => `${key} = "${this[key]}"`)
        ].join('\n')
        );
    }

    load() {
        if(!fs.existsSync('samconfig.toml')) {
            console.error('samtsc: no sam config file found');
            return;
        }
        const parts = fs.readFileSync('samconfig.toml').toString().split('\n');

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
    const pck = JSON.parse(fs.readFileSync(`${source}/package.json`).toString());
    if(pck.dependencies) {
        Object.keys(pck.dependencies).forEach(key => {
            if(pck.dependencies[key].startsWith('file:')) {
                const subprefix = pck.dependencies[key].slice(5);
                const res = path.resolve(source, subprefix);
                pck.dependencies[key] = `file:${res}`;
            }
        });
    }

    fs.writeFileSync(`${buildRoot}/${source}/package.json`, JSON.stringify(pck, '  '));
    if(pck.dependencies) {
        execOnlyShowErrors('npm i --only=prod', { cwd: `${buildRoot}/${source}`});
    }
    console.log('samtsc: Completed package.json', source);
}

function findTsConfigDir(dirPath) {
    const configPath = dirPath + '/tsconfig.json';
    if(fs.existsSync(configPath)) {
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
        this.watchHandler = fs.watch(dirPath, { recursive: true }, (event, path) => { self.build(path); });
        this.notificationType = notificationType;
    }

    cleanup() {
        this.watchHandler.close();
    }

    loadOutDir() {
        if(this.tsconfigDir) {
            console.log('samtsc: Loading tsconfig in', this.tsconfigDir);
            const tsconfig = JSON.parse(fs.readFileSync(`${this.tsconfigDir}/tsconfig.json`).toString());
            if(tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.outDir) {
                this.outDir = tsconfig.compilerOptions.outDir;
            }
        }
        if(!this.outDir) {
            this.outDir = '';
        }
    }

    installDependencies() {
        execOnlyShowErrors(`npm i`, { cwd: this.path });
    }

    build(filePath) {
        if(filePath && this.outDir && (filePath.startsWith(this.outDir) || filePath.indexOf('node_modules') >= 0)) {
            return;
        }

        if(!folderUpdated(this.path)) {
            console.log('samtsc: No build needed');
            return;
        }

        filePath && console.log('samtsc: File changed ', filePath);

        if((!filePath && !fs.existsSync(this.path + '/node_modules')) || (filePath && filePath.indexOf('package.json') >= 0)) {
            this.installDependencies();
        }

        if(this.tsconfigDir) {
            console.log('samtsc: building path ', this.path);
            if(this.outDir) {
                const localOutDir = path.resolve(this.tsconfigDir, this.outDir);
                const outDir = path.resolve(process.cwd(), `${buildRoot}/${this.tsconfigDir}/${this.outDir}`);
                if(fs.existsSync(localOutDir)) {
                    execOnlyShowErrors(`bash -c "rm -R ${localOutDir}"`, { cwd: this.path })
                }
                execOnlyShowErrors(`bash -c "mkdir -p ${outDir}"`, { cwd: this.path })
                execOnlyShowErrors(`npx tsc -d`, { cwd: this.path });
                execOnlyShowErrors(`bash -c "cp -R dist ${outDir}"`, { cwd: this.path });
            } else {
                const outDir = path.resolve(process.cwd(), `${buildRoot}/${this.tsconfigDir}/${this.outDir}`);
                // if(fs.existsSync(outDir)) {
                //     execOnlyShowErrors(`bash -c "rm -R ${outDir}"`, { cwd: this.path })
                // }
                execOnlyShowErrors(`npx tsc -d --outDir ${outDir}`, { cwd: this.path });
            }
            console.log('samtsc: build complete', this.path);
        }
        if(!filePath || filePath.indexOf('package.json') >= 0) {
            buildPackageJson(this.path);
        }
        writeCacheFile(this.path);
        if(this.eventObject) {
            this.events.emit(this.notificationType, this.eventObject);
        }
        if(this.deploy && filePath) {
            this.deploy(filePath);
        }
    }
}

class SAMLayerLib extends SAMCompiledDirectory {
    constructor(dirPath, parent, events) {
        super(dirPath, parent, events, 'layer-change');
    }
}

class SAMLayer {
    constructor(name, properties, stackname, events) {
        this.name = name;
        this.path = properties.ContentUri;
        this.layerName = properties.LayerName || `${stackname}-${name}`;

        console.log(`samtsc: Identified Serverless Layer: ${this.path}`);
        
        this.pck = JSON.parse(fs.readFileSync(`${this.path}/package.json`).toString());

        const self = this;
        this.events = events;
        this.libs = Object.values(this.pck.dependencies).filter(d => {
            if(!d.startsWith('file:')) {
                return false;
            }
            const subpath = path.resolve(this.path, d.slice(5));
            return subpath.startsWith(process.cwd());
        }).map(d => {
            const fullPath = path.resolve(this.path, d.slice(5));
            const subpath = path.relative(process.cwd(), fullPath);
            return new SAMLayerLib(subpath, self, self.events);
        });

        this.watchHandler = fs.watch(this.path + '/package.json', { recursive: true }, (event, filePath) => { self.handleFolderEvent(filePath); });
    }

    handleFolderEvent(path) {
        console.log('samtsc: file change ', path);
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
        this.functionName = (properties.FunctionName || `${stackname}-${name}`).trim();
        this.deploy = this.deployFunction;
    }

    deployFunction(filePath) {
        console.log('samtsc: Packaging function', this.name);
        const zipFile = `${tempDir}/${this.functionName}.zip`;
        
        if(filePath == 'package.json' || !fs.existsSync(`${buildRoot}/${this.path}/node_modules`)) {
            const content = JSON.parse(fs.readFileSync(path.resolve(this.path, 'package.json')));
            if(content.dependencies && Object.keys(content.dependencies)) {
                console.log('samtsc: Updating dependencies');
                execOnlyShowErrors('npm i --only=prod', { cwd: `${buildRoot}/${this.path}`})        
            }
        }

        console.log('samtsc: packaging up function');
        execOnlyShowErrors(`bash -c "zip -r ${zipFile} ${buildRoot}/${this.path}"`);
        const zipContents = fs.readFileSync(zipFile);
        const self = this;
        console.log('samtsc: Deploying function', this.name);
        cf.listStackResources({
            StackName: samconfig.stack_name
        }).promise()
        .then((result) => {
            const resource = result.StackResourceSummaries.find(x => x.LogicalResourceId == self.name);
            
            return lambda.updateFunctionCode({
                FunctionName: resource.PhysicalResourceId,
                ZipFile: zipContents
            }).promise();
        }).then(() => {
            console.log('samtsc: Function deployment complete', this.name);
        }).catch((err) => {
            console.log('samtsc: Function deployment FAILED', err);
        });
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

        fs.watchFile(path, (curr, prev) => {
            self.reload();
        });
    }

    async reload() {
        console.log('samtsc: Loading Template', this.path);
        if(!fs.existsSync('samconfig.toml')) {
            throw new Error('No samconfig.toml found for default deployment configurations');
        }
        console.log(this.path);
        samconfig.save();

        const content = fs.readFileSync(this.path);
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
        console.log('Global Uri', globalUri);

        const self = this;
        const layerKeys = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::LayerVersion');
        this.layers = layerKeys
            .map(key => {
                const resource = template.Resources[key];
                return new SAMLayer(key, resource.Properties, samconfig.stack_name, self.events);
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

        fs.writeFileSync(`${buildRoot}/${this.path}`, yaml.dump(template, { schema: cfSchema.CLOUDFORMATION_SCHEMA}));
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
                console.log('samtsc: Building', f.path);
                f.libs.forEach(l => {
                    console.log('samtsc: Building', l.path);
                    l.build();
                });
            } catch (err) {
                console.log('samtsc: could not install or compile', f.path);
                console.log(err);
            }
        });

        this.template.functions.forEach(f => {
            try {
                console.log('samtsc: Building', f.path);
                execOnlyShowErrors('npm i', { cwd: f.path }, { });
                f.build();
            } catch (err) {
                console.log('samtsc: could not install or compile ', f.path);
                console.log(err);
            }
        });

        if(samconfig.skip_init_deploy != 'true') {
            console.log('samtsc: Building SAM deployment');
            execSync('sam build', { cwd: buildRoot, stdio: 'inherit' });
            console.log('samtsc: Completed building SAM deployment');
            execSync('sam deploy --no-fail-on-empty-changeset --no-confirm-changeset', { cwd: buildRoot, stdio: 'inherit' });
        }

        this.events.on('layer-change', (source) => { self.deployChange(source) });
    }

    deployChange(source, skipDeploy) {
        if(this.mode == 'publish') {
            // TODO: Make sure to stop debug mode
        }

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

    layerChange(source) {
        if(!folderUpdated(source.path)) {
            return;
        }
        console.log('samtsc: File Changed');
        if(this.mode == 'publish') {
            // TODO: Make sure to stop debug mode
        }
        
        console.log('samtsc: Building package.json');
        buildPackageJson(source.path);

        try {
            console.log('samtsc: Installing production dependencies');
            execOnlyShowErrors(`npm i --only=prod -p ${this.buildRoot}/${source.path}`);

            console.log('samtsc: Building functions: ', functions.length);
            execOnlyShowErrors(`sam build ${source.name}`, { cwd: this.buildRoot });
            
            if(this.mode == 'publish') {
                console.log('samtsc: Deploying');
                execOnlyShowErrors(`sam deploy`, { cwd: this.buildRoot });
            }
        } catch (err) {
            return;
        }
    }
}

module.exports.SAMFramework = SAMFramework;