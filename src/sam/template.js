const yaml = require('js-yaml');
const { existsSync, writeFileSync, readFileSync, unlinkSync } = require('../file-system');
const { relative } = require('path');
const cfSchema = require('cloudformation-js-yaml-schema');
const aws = require('aws-sdk');
const { logger } = require('../logger');
const { EventEmitter } = require('events');
const { SAMLayer } = require('./layer');
const { SAMFunction } = require('./function');
const { SAMCompiledDirectory } = require('./compiled-directory');
const { writeCacheFile, folderUpdated } = require('../tsc-tools');

function filterRefs(array) {
    if(!array) {
        return [];
    }
    return array.filter(x => x.name == 'Ref').map(x => x.data).filter(x => x? true : false);
}

class SAMTemplate {
    constructor(path, buildRoot, samconfig) {
        this.samconfig = samconfig;
        this.path = path;
        this.buildRoot = buildRoot;
        this.events = new EventEmitter();
        this.ssm = new aws.SSM({ region: samconfig.region });
    }

    cleanup() {
        this.compiledDirectories && Object.values(this.compiledDirectories).forEach(x => x.cleanup());
        this.layers && this.layers.forEach(l => l.cleanup());
        this.functions && this.functions.forEach(f => f.cleanup());
    }

    fileEvent(filePath) {
        if(this.path == filePath && folderUpdated(this.path)) {
            this.reload();
            writeCacheFile(this.path, true);
        }

        Object.values(this.compiledDirectories).forEach(d => {
            if(filePath.startsWith(d.path)) {
                const subpath = relative(d.path, filePath);
                d.fileEvent(subpath);
            }
        });
        this.layers.forEach(l => {
            if(filePath.startsWith(l.path)) {
                const subpath = relative(d.path, filePath);
                l.fileEvent(subpath);
            }

            if(l.libs) {
                l.libs.forEach(d => {
                    if(filePath.startsWith(d.path)) {
                        const subpath = relative(d.path, filePath);
                        d.fileEvent(subpath);
                    }
                });
            }
        });
    }

    async reload() {
        console.log('samtsc: Loading Template', this.path);
        if(!existsSync('samconfig.toml')) {
            throw new Error('No samconfig.toml found for default deployment configurations');
        }
        this.samconfig.save();

        const content = readFileSync(this.path).toString();
        console.log('File read');
        const template = yaml.load(content, {
            schema: cfSchema.CLOUDFORMATION_SCHEMA
        });

        if(this.samconfig.env_aware == 'true' && template.Parameters) {
            console.log('samtsc: environment aware turned on');
            Object.keys(template.Parameters)
            .forEach(key => {
                if(!template.Parameters[key].Default) {
                    return;
                }
                template.Parameters[key].Default = template.Parameters[key].Default.replace(/\<EnvironmentName\>/g, this.samconfig.environment);
            });
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
                    const layer = new SAMLayer(key, resource.Properties, resource.Metadata, this.samconfig.stack_name, self.buildRoot, this.samconfig);
                    layer.events.on('layer-change', () => self.events.emit('layer-change'));
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
                    samFunc = new SAMFunction(key, resource.Properties, globalUri, self.samconfig);
                    this.functions.push(samFunc);
                }
                let compDir = this.compiledDirectories[samFunc.path];
                if(!compDir) {
                    console.log('samtsc: Constructing directory to compile', samFunc.path);
                    compDir = new SAMCompiledDirectory(samFunc.path, this.samconfig, this.buildRoot);
                    compDir.installAtLeastOnce();
                    compDir.build(undefined, true);
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


        if(this.samconfig.parm_layer == 'true') {
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
                const paramResults = await this.ssm.getParameters({
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

        const buildPath = `${this.buildRoot}/${this.path}`;
        if(existsSync(buildPath)) {
            unlinkSync(buildPath);
        }

        if(this.samconfig.marker_tag) {
            const resourceName = `DeploymentMarkerTag${this.samconfig.marker_tag}`;
            Object.values(template.Resources).forEach(r => {
                if(!r.DependsOn) {
                    r.DependsOn = resourceName;
                } else if(typeof r.DependsOn == 'string') {
                    r.DependsOn = [r.DependsOn, resourceName];
                } else if(Array.isArray(r.DependsOn)) {
                    r.DependsOn.push(resourceName);
                }
            });
            template.Resources[resourceName] = {
                Type: 'AWS::CloudFormation::WaitConditionHandle'
            };
            if(!template.Outputs) {
                template.Outputs = {};
            }
            template.Outputs['DeploymentHistoryTag'] = {
                Description: 'Stackery Deployment History Tag',
                Value: this.samconfig.marker_tag
            };
        }
        console.log('samtsc: Writing file', buildPath)
        this.parameters = template.Parameters;
        writeFileSync(buildPath, yaml.dump(template, { schema: cfSchema.CLOUDFORMATION_SCHEMA}));
        this.events.emit('template-update', this);
    }
}
module.exports.SAMTemplate = SAMTemplate;
