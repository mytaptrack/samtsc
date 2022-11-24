const yaml = require('js-yaml');
const { existsSync, writeFileSync, readFileSync, unlinkSync, mkdir } = require('../file-system');
const { relative, resolve } = require('path');
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
    constructor(path, buildRoot, samconfig, stackName, isSubstack) {
        this.samconfig = samconfig;
        this.stackName = stackName;
        this.path = path;
        this.buildRoot = buildRoot;

        const lastForwardSlash = path.lastIndexOf('/');
        this.stackDir = lastForwardSlash > 0? path.slice(0, lastForwardSlash) : ".";
        
        this.events = new EventEmitter();
        this.ssm = new aws.SSM({ region: samconfig.region });
        this.cf = new aws.CloudFormation({ region: samconfig.region });
    }

    cleanup() {
        this.compiledDirectories && Object.values(this.compiledDirectories).forEach(x => x.cleanup());
        this.layers && this.layers.forEach(l => l.cleanup());
        this.functions && this.functions.forEach(f => f.cleanup());
    }

    fileEvent(filePath) {
        if(!filePath) {
            return;
        }
        if(this.path == filePath && folderUpdated(this.path)) {
            this.reload();
            writeCacheFile(this.path, true);
        }

        if(this.substacks) {
            this.substacks.forEach(x => x.fileEvent(filePath));
        }
        if(this.compiledDirectories) {
            Object.values(this.compiledDirectories).forEach(d => {
                const subpath = relative(d.path, filePath);
                if(!subpath.startsWith('..')) {
                    d.fileEvent(subpath);
                }
            });
        }
        if(this.layers) {
            this.layers.forEach(l => {
                const subpath = relative(l.path, filePath);
                if(!subpath.startsWith('..')) {
                    l.fileEvent(subpath);
                }

                if(l.libs) {
                    l.libs.forEach(d => {
                        const subpath = relative(d.path, filePath);
                        if(!subpath.startsWith('..')) {
                            d.fileEvent(subpath);
                        }
                    });
                }
            });
        }
    }

    async reload() {
        console.log('samtsc: Loading Template', this.path);
        if(!this.isSubstack && !existsSync('samconfig.toml')) {
            throw new Error('No samconfig.toml found for default deployment configurations');
        }
        this.samconfig.save();

        let nextToken;
        const resources = [];
        if(this.stackName && !this.samconfig.package) {
            try {
                do {
                    const result = await this.cf.listStackResources({
                        StackName: this.stackName,
                        NextToken: nextToken
                    }).promise();
                    nextToken = result.NextToken;
                    if(result.StackResourceSummaries) {
                        resources.push(...result.StackResourceSummaries);
                    }
                } while(nextToken);
            } catch (err) {
                logger.error(err);
            }
        }

        const content = readFileSync(this.path).toString();
        console.log('File read');
        const template = yaml.load(content, {
            schema: cfSchema.CLOUDFORMATION_SCHEMA
        });
        this.parameters = template.Parameters;

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

        const applicationKeys = Object.keys(template.Resources)
            .filter(key => template.Resources[key].Type == 'AWS::Serverless::Application');
        if(applicationKeys && applicationKeys.length > 0) {
            const subStackRef = [];
            this.substacks = applicationKeys.map(key => {
                const resource = resources.find(x => x.LogicalResourceId == key);
                let substackName = '';
                if(resource) {
                    substackName = resource.PhysicalResourceId;
                }
                const location = template.Resources[key].Properties.Location;
                const retval = new SAMTemplate(location, this.buildRoot, this.samconfig, substackName, true);
                retval.events.on('template-update', () => {
                    self.events.emit('template-update', self);
                });
                subStackRef.push({
                    declaration: template.Resources[key],
                    template: retval
                });
                return retval;
            });
            await Promise.all(this.substacks.map(async x => {
                await x.reload();
                logger.debug('Substack params', x);
                if(x.parameters) {
                    Object.keys(x.parameters).forEach(key => {
                        const p = x.parameters[key];
                        logger.debug(JSON.stringify(p));
                        if(!p.Default && p.Type && p.Type.indexOf('AWS::SSM::Parameter::Value') != 0) {
                            return;
                        }

                        // Check if parent stack has this parameter passed in
                        const stack = subStackRef.find(y => y.template == x);
                        const subParams = stack && 
                                            stack.declaration &&
                                            stack.declaration.Properties &&
                                            stack.declaration.Properties.Parameters? 
                                            stack.declaration.Properties.Parameters : undefined;
                        if(subParams && subParams[key]) {
                            return;
                        }

                        // Add parameters to parent stack
                        if(!this.parameters[`SubStack${key}`]) {
                            this.parameters[`SubStack${key}`] = {
                                Type: 'String',
                                Default: p.Default
                            };
                        }
                        subParams[key] = { Ref: `SubStack${key}`};
                    });
                }
            }));
        }

        if(template.Parameters && !this.isSubstack) {
            logger.warn('environment aware turned on');
            const environments = this.samconfig.package && this.samconfig.environments? this.samconfig.environments.split(',') : [this.samconfig.environment];
            this.templateConfigurations = environments.map(env => {
                const retval = {
                    Parameters: {},
                    Tags: {
                        "environment": env
                    }
                };
                const envAware = this.samconfig.env_aware == 'true' || this.samconfig.env_aware == true;
                logger.debug('envAware', envAware);
                Object.keys(template.Parameters)
                    .forEach(key => {
                        if(!template.Parameters[key].Default) {
                            return;
                        }
                        if(key == 'EnvironmentTagName') {
                            retval.Parameters[key] = env;
                        } else {
                            retval.Parameters[key] = template.Parameters[key].Default.toString();
                        }
                        if(envAware) {
                            retval.Parameters[key] = retval.Parameters[key]
                                .replace(/\<EnvironmentName\>/g, env)
                                .replace(/\<DevStack\>/g, this.samconfig.dev_stack? this.samconfig.dev_stack : '');
                        }
                    });
                logger.debug('Writing config for', env);
                writeFileSync(resolve(this.buildRoot, `template-${env}.config`), JSON.stringify(retval, undefined, '  '));
                return retval;
            });
            logger.debug('templateConfigurations', this.templateConfigurations);
        }

        if(!this.compiledDirectories) {
            this.compiledDirectories = {};
        }
        if(!this.functions) {
            this.functions = [];
        }
        const functionKeys = Object.keys(template.Resources)
        .filter(key => template.Resources[key].Type == 'AWS::Serverless::Function' && !template.Resources[key].Properties.InlineCode);

        functionKeys.forEach(key => {
                const resource = template.Resources[key];
                let samFunc = this.functions.find(x => x.name == key);
                if(samFunc) {
                    samFunc.setConfig(resource.Properties, globalUri);
                } else {
                    samFunc = new SAMFunction(key, resource.Properties, globalUri, self.samconfig, this.stackName, resources);
                    this.functions.push(samFunc);
                }
                let compDir = this.compiledDirectories[samFunc.path];
                if(!compDir) {
                    console.log('samtsc: Constructing directory to compile', samFunc.path);
                    const dirPath = relative('.', resolve(this.stackDir, samFunc.path));
                    compDir = new SAMCompiledDirectory(dirPath, this.samconfig, this.buildRoot);
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

            x.cleanup();
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

            const paramNames = Object.keys(template.Parameters || {});
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
        const absPath = resolve(buildPath);
        if(existsSync(absPath)) {
            logger.debug('File exists', absPath);
            unlinkSync(absPath);
        }
        const folder = relative(buildPath, '..');
        if(!existsSync(folder)) {
            mkdir(folder);
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

        if(this.samconfig.base_stack && template.Parameters && template.Parameters.StackTagName) {
            template.Parameters.StackTagName.Default = this.samconfig.base_stack;
        }
        if(this.samconfig.base_stack && template.Parameters && template.Parameters.StackName) {
            template.Parameters.StackName.Default = this.samconfig.base_stack;
        }
        if(this.samconfig.environment && template.Parameters && template.Parameters.EnvironmentTagName) {
            template.Parameters.EnvironmentTagName.Default = this.samconfig.environment;
        }
        if(this.samconfig.environment && template.Parameters && template.Parameters.EnvironmentName) {
            template.Parameters.EnvironmentName.Default = this.samconfig.environment;
        }
        if(this.samconfig.dev_stack && template.Parameters && template.Parameters.DevStackName) {
            template.Parameters.DevStackName.Default = this.samconfig.dev_stack;
        }

        console.log('samtsc: Writing file', buildPath)
        this.fixGlobalApiPermissions(template);
        this.mergeGlobalPolicies(template);
        let templateString = yaml.dump(template, { schema: cfSchema.CLOUDFORMATION_SCHEMA});
        if(this.samconfig.region) {
            templateString = templateString.replace(/https:\/\/s3.[a-z\-0-9]+.amazonaws.com/g, `https://s3.${this.samconfig.region}.amazonaws.com`);
        }
        writeFileSync(buildPath, templateString);
        
        this.events.emit('template-update', this);
    }

    /**
     * This function is used to fix permissions for global api references.
     * There is an issue in the sam framework where global apis are not given
     * invoke permissions on lambda functions.
     * @param {map} template 
     */
    fixGlobalApiPermissions(template) {
        Object.keys(template.Resources)
        .filter(x => {
            const f = template.Resources[x];
            if(f.Type != 'AWS::Serverless::Function' || !f.Properties || !f.Properties.Events) {
                return;
            }

            if(!Object.values(f.Properties.Events).find(y => {
                return y.Type == 'Api' && y.Properties;
            })) {
                return;
            }

            if(Object.values(template.Resources).find(y => {
                if(y.Type != 'AWS::Lambda::Permission' || !y.Properties) {
                    return;
                }
                if(y.Properties.Action != 'lambda:InvokeFunction' || 
                    !y.Properties.FunctionName ||
                    !(y.Properties.FunctionName.Ref == x || y.Properties.FunctionName.data == x)) {
                    return;
                }
                return true;
            })) {
                return;
            }
            return true;
        }).forEach(x => {
            let apiResource =  'ServerlessRestApi';
            const f = template.Resources[x];
            const ev = Object.values(f.Properties.Events).find(y => {
                return y.Type == 'Api' && y.Properties && y.Properties.RestApiId;
            });
            if(ev) {
                apiResource = ev.Properties.RestApiId.Ref || ev.Properties.RestApiId.data || apiResource;
            }
            const permissions = {
                Type: 'AWS::Lambda::Permission',
                Properties: {
                    Action: 'lambda:InvokeFunction',
                    FunctionName: { Ref: x },
                    Principal: 'apigateway.amazonaws.com',
                    SourceArn: { 'Fn::Sub': "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${" + apiResource + "}/*/*/*" }
                }
            };
            template.Resources[x + 'Permissions' + new Date().getTime().toString()] = permissions;
        });
    }


    mergeGlobalPolicies(template) {
        if(!(template.Globals && template.Globals.Function && template.Globals.Function.Policies)) {
            return;
        }

        const globalPolicies = template.Globals.Function.Policies.find(x => !x.Statement);
        if(!Array.isArray(template.Globals.Function.Policies)) {
            logger.error('Globals.Function.Policies is not an array', globalPolicies);
            throw new Error('Globals.Function.Policies is not an array');
        }
        const statement = template.Globals.Function.Policies.find(x => x.Statement);

        Object.values(template.Resources)
            .filter(f => f.Type == 'AWS::Serverless::Function' && f.Properties)
            .forEach(f => {
                if(!f.Properties.Policies) {
                    f.Properties.Policies = [];
                }
                if(statement) {
                    const curStatement = f.Properties.Policies.find(x => x.Statement);
                    if(!curStatement) {
                        f.Properties.Policies.push(statement);
                    } else {
                        curStatement.Statement.push(...statement.Statement);
                    }
                }

                if(globalPolicies) {
                    f.Properties.Policies.push(globalPolicies);
                }
            });

        delete template.Globals.Function.Policies;
    }
}
module.exports.SAMTemplate = SAMTemplate;
