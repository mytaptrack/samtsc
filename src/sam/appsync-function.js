const aws = require('@aws-sdk/client-appsync');
const { mkdir, existsSync, writeFileSync, readFileSync } = require('../file-system');
const { relative, resolve } = require('path');
const { logger } = require('../logger');

class AppSyncFunctionConfiguration {
    constructor(name, properties, buildRoot, stackResources, appsyncId, samconfig) {
        this.appsync = new aws.AppSync({ region: samconfig.region });
        this.name = name;
        this.buildRoot = buildRoot;
        this.setConfig(properties, stackResources, appsyncId);
    }

    load() {
        logger.info('Path', this.compDir?.buildRoot, this.compDir?.path);
        const path = this.compDir ? resolve(this.compDir.buildRoot, this.compDir.path, this.fileName) : this.source;
        logger.info('Validating path', path);
        if(!existsSync(path)) {
            logger.error('Could not file file at path', path);
            return;
        }

        const content = readFileSync(path);
        this.properties.Code = content.toString();
    }

    setConfig(properties, resource, appsyncId) {
        this.properties = properties;
        this.resource = resource;
        this.appsyncId = appsyncId;
        logger.debug('Properties', properties);
        this.source = properties.CodeS3Location? resolve(properties.CodeS3Location) : undefined;
        this.fileName = this.source.slice(this.source.lastIndexOf('/') + 1);
        if(this.fileName.endsWith('.ts')) {
            this.fileName = this.fileName.slice(0, this.fileName.length - 3) + '.js';
        }
        if(this.source) {
            delete this.properties.CodeS3Location;
            this.load();
        }
    }
    setCompDir(compDir) {
        if(this.compDir == compDir) {
            return;
        }

        if(this.compDir) {
            this.compDir.events.removeListener('package', this.listener);
        }

        this.compDir = compDir;
        this.load();

        const self = this;
        compDir.events.on('build-complete', (path) => {
            logger.debug('Received appsync function deploy event');
            self.deployFunction(resolve(path, this.fileName));
        });
    }
    fileEvent() {
        if(this.compDir) {
            // Events shouldn't be from the file system as the source needs to be compiled
            return;
        }
        this.deployFunction(this.source);
    }
    deployFunction(sourcePath) {
        let path = sourcePath;
        if(!existsSync(path)) {
            logger.error('Could not file file at path', path);
            return;
        }

        if(this.updating || !this.resource?.PhysicalResourceId) {
            return;
        }

        logger.info('Preparing appsync function update', path);

        this.updating = true;
        const content = readFileSync(path);
        this.properties.Code = content.toString();

        const getParams = {
            apiId: this.appsyncId,
            functionId: this.resource.PhysicalResourceId.slice(this.resource.PhysicalResourceId.lastIndexOf('/') + 1),
        };
        logger.info('Getting appsync function');
        this.appsync.getFunction(getParams).then(data => {
            logger.info('Function retrieved');
            const conf = data.functionConfiguration;
            const params = {
                apiId: this.appsyncId,
                functionId: conf.functionId,
                name: this.properties.Name,
                description: this.properties.Description,
                dataSourceName: conf.dataSourceName,
                code: this.properties.Code,
                runtime: {
                    name: this.properties.Runtime.Name,
                    runtimeVersion: this.properties.Runtime.RuntimeVersion
                }
            };
            logger.info('Updating appsync function');
            this.appsync.updateFunction(params).then(() => {
                logger.success('Updated appsync function', this.properties.Name);
                this.updating = false;
            }).catch(err => {
                logger.error('Error updating appsync function', this.properties.Name, err);
                this.updating = false;
            });
    
        }).catch(err => {
            logger.error('Error getting appsync function', this.properties.name, err);
            this.updating = false;
        });
    }
}

module.exports = { AppSyncFunctionConfiguration };