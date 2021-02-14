const aws = require('aws-sdk');
const { logger } = require('../logger');
const { EventEmitter } = require('events');

class SAMFunction {
    constructor(name, properties, globalUri, samconfig) {
        this.name = name;
        this.samconfig = samconfig;
        this.lambda = new aws.Lambda({ region: samconfig.region });
        this.cf = new aws.CloudFormation({ region: samconfig.region });
        this.events = new EventEmitter();
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

    cleanup() {
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
        if(this.samconfig.no_deploy) {
            this.events.emit('deploy-complete');
            return;
        }
        try {
            const self = this;
            console.log('samtsc: Deploying function', this.name);
            if(!this.functionName) {
                let nextToken;
                let resource;
                do {
                    const result = await this.cf.listStackResources({
                        StackName: this.samconfig.stack_name,
                        NextToken: nextToken
                    }).promise();
                    nextToken = result.NextToken;
                    resource = result.StackResourceSummaries.find(x => x.LogicalResourceId == self.name);
                    
                } while(!resource && nextToken);
                if(!resource) {
                    console.log('samtsc: Could not find function name');
                    throw new Error('No function name found');
                }
                this.functionName = resource.PhysicalResourceId;
            }
            await this.lambda.updateFunctionCode({
                FunctionName: this.functionName,
                ZipFile: zipContents
            }).promise();
            this.events.emit('deploy-complete');
            
            console.log('samtsc: Function deployment complete', this.name);
        } catch (err) {
            console.log('samtsc: Function deployment FAILED', err);
        }
    }
}

module.exports.SAMFunction = SAMFunction;