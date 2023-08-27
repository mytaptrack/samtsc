const aws = require('@aws-sdk/client-lambda');
const { logger } = require('../logger');
const { EventEmitter } = require('events');

class SAMFunction {
    constructor(name, properties, globalUri, samconfig, stackName, stackResources) {
        this.name = name;
        this.stackName = stackName;
        this.stackResources = stackResources;
        this.samconfig = samconfig;
        this.lambda = new aws.Lambda({ region: samconfig.region });
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
            logger.info('Deploying function', this.name);
            if(!this.functionName) {
                const resource = this.stackResources.find(x => x.LogicalResourceId == self.name);
                if(!resource) {
                    logger.error('Could not find function name');
                    throw new Error('No function name found');
                }
                this.functionName = resource.PhysicalResourceId;
            }
            await this.lambda.updateFunctionCode({
                FunctionName: this.functionName,
                ZipFile: zipContents
            }).promise();
            this.events.emit('deploy-complete');

            logger.info('Function deployment complete', this.name);
        } catch (err) {
            logger.error('Function deployment FAILED', err);
        }
    }
}

module.exports.SAMFunction = SAMFunction;