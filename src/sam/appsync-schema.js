const aws = require('@aws-sdk/client-appsync');

const { mkdir, existsSync, writeFileSync, readFileSync } = require('../file-system');
const { relative, resolve } = require('path');
const { logger } = require('../logger');

class AppSyncSchema {
    constructor(name, properties, buildRoot, stackResources, appsyncId, samconfig) {
        this.appsync = new aws.AppSync({ region: samconfig.region });
        this.name = name;
        this.buildRoot = buildRoot;
        this.paths = [];
        this.setConfig(properties, stackResources, appsyncId);
    }

    load() {
        logger.debug('Path', this.buildRoot, this.source);
        const path = this.source;
        logger.debug('Validating path', path);
        if(!existsSync(path)) {
            logger.error('Could not file file at path', path);
            return;
        }

        this.paths = [path];
        let content = readFileSync(path).toString();
        const imports = content.match(/\#include +\".*\"/g);
        logger.info("Checking includes", imports);
        if(imports) {
            imports.forEach(imp => {
                logger.info("Resolving import", imp);
                const importPath = resolve(path, '..', imp.match(/#include +\"(.*)\"/)[1]);
                logger.info('Include path', importPath);
                if(!existsSync(importPath)) {
                    logger.error('Could not find import file', importPath);
                    return;
                }
                const subContent = readFileSync(importPath).toString();
                content = content.replace(imp, subContent);
                this.paths.push(importPath);
            });
        }

        delete this.properties.DefinitionS3Location;
        this.properties.Definition = content;
    }

    setConfig(properties, resource, appsyncId) {
        this.properties = properties;
        this.resource = resource;
        this.appsyncId = appsyncId;
        logger.debug('Properties', properties);
        this.source = properties.DefinitionS3Location? resolve(properties.DefinitionS3Location) : undefined;
        if(this.source) {
            this.load();
        }
    }
    fileEvent() {
        const path = this.source;
        if(!existsSync(path)) {
            logger.error('Could not file file at path', path);
            return;
        }

        if(this.updating) {
            return;
        }

        this.updating = true;
        this.load();

        const params = {
            apiId: this.appsyncId,
            definition: this.properties.Definition,
        };
        logger.info('Updating appsync schema');
        this.appsync.startSchemaCreation(params).promise().then((data) => {
            this.waitForAppsyncStatus().then(() => {
                this.updating = false;
            }).catch(err => {
                logger.error('Error waiting for appsync schema update', err);
                this.updating = false;
            });
        }).catch(err => {
            logger.error('Error updating appsync schema', err);
            this.updating = false;
        });
    }
    waitForAppsyncStatus() {
        return this.appsync.getSchemaCreationStatus({ apiId: this.appsyncId }).promise().then((data) => {
            if(data.status == 'SUCCESS') {
                logger.success('Updated appsync schema');
                return;
            }
            if(data.status == 'FAILED' || data.status == 'NOT_APPLICABLE') {
                logger.error('The schema deployment failed', data);
                return;
            }

            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(this.waitForAppsyncStatus());
                }, 1000)
            });
        });
    }
}

module.exports = { AppSyncSchema };