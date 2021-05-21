const { existsSync, readFileSync, writeFileSync } = require('../file-system');
const { resolve } = require('path');
const { logger } = require('../logger');

let stackeryConfig;
if(process.env.stackery_config) {
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
        this.load({});
    }

    save() {
        writeFileSync(resolve(this.buildRoot, 'samconfig.toml'),
        [
            'version=0.1',
            '[default.deploy.parameters]',
            ...Object.keys(this).map(key => `${key} = "${this[key]}"`)
        ].join('\n')
        );
    }

    load(buildFlags, buildRoot) {
        this.buildRoot = buildRoot;
        if(!existsSync('samconfig.toml')) {
            console.error('samtsc: no sam config file found');
            return;
        }
        const parts = readFileSync('samconfig.toml').toString().split('\n');
        const environment = buildFlags['config-env'] || 'default';

        const environments = parts.map((x, i) => {
            if(x.match(/\[[\w\.]+\]/)) {
                return {
                    line: x,
                    index: i
                };
            }
            return null;
        }).filter(x => x != null);

        const currentEnvOffset = environments.find(x => x.line.indexOf(`${environment}.deploy.parameters`) > 0);

        if(currentEnvOffset < 0) {
            logger.error('Could not find environment in samconfig.toml');
            throw new Error('Invalid configuration');
        }

        if(currentEnvOffset.index < environments.length - 1) {
            parts.splice(environments[currentEnvOffset.index + 1].index);
        }
        if(currentEnvOffset.index > 0) {
            parts.splice(0, currentEnvOffset.index);
        }

        const self = this;
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
        Object.keys(buildFlags).forEach(key => {
            self[key] = buildFlags[key];
        });

        if(stackeryConfig) {
            this.base_stack = stackeryConfig.stackName;
            this.environment = stackeryConfig.environmentName;
            this.region = stackeryConfig.region;
            this.s3_bucket = stackeryConfig.s3BucketName;
            this.stack_name = stackeryConfig.cloudFormationStackName;

            if(existsSync(`.stackery/${stackeryConfig.templatePath}`)) {
                const content = readFileSync(`.stackery/${stackeryConfig.templatePath}`).toString();
                const yaml = require('js-yaml');
                const cfSchema = require('cloudformation-js-yaml-schema');
                
                try {
                    const stackeryYaml = yaml.load(content, {
                        schema: cfSchema.CLOUDFORMATION_SCHEMA
                    });
        
                    if(stackeryYaml && stackeryYaml.Outputs && stackeryYaml.Outputs.DeploymentHistoryTag) {
                        this.marker_tag = stackeryYaml.Outputs.DeploymentHistoryTag.Value;
                    } else {
                        console.log('samtsc: yaml error', content);
                    }
                } catch (err) {
                    console.error(err);
                    console.log(content);
                }
            }
        }

        if(this.base_stack && this.environment) {
            this.stack_name = `${this.base_stack}-${this.environment}`;
        } else {
            console.log('samtsc: Could not find or construct stack name');
            process.exit(1);
        }

        if(existsSync('dev.stack.txt')) {
            const addToStack = readFileSync('dev.stack.txt').toString().trim();
            if(addToStack) {
                this.stack_name = `${this.stack_name}-${addToStack}`;
                logger.warn('Setting up developer isolated stack', this.stack_name);
            }
        }
    }
}

const samconfig = new SAMConfig();
module.exports.samconfig = samconfig;
module.exports.SAMConfig = SAMConfig;
