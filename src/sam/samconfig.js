const { existsSync, readFileSync, writeFileSync } = require('../file-system');
const { resolve } = require('path');
const { logger } = require('../logger');
const { SSM } = require('@aws-sdk/client-ssm');

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

    async load(buildFlags, buildRoot) {
        this.buildRoot = buildRoot;
        if(!existsSync('samconfig.toml')) {
            console.error('samtsc: no sam config file found');
            return;
        }
        const parts = readFileSync('samconfig.toml').toString().split('\n');
        const environment = buildFlags['config_env'] || 'default';

        const environments = parts.map((x, i) => {
            if(x.match(/\[[\w\.]+\]/)) {
                return {
                    line: x,
                    index: i
                };
            }
            return null;
        }).filter(x => x != null);

        const currentEnvOffset = environments.findIndex(x => x.line.indexOf(`${environment}.deploy.parameters`) > 0);

        if(currentEnvOffset < 0) {
            logger.error('Could not find environment in samconfig.toml');
            throw new Error('Invalid configuration');
        }

        if(currentEnvOffset < environments.length - 1) {
            parts.splice(environments[currentEnvOffset + 1].index);
        }
        if(currentEnvOffset > 0) {
            parts.splice(0, environments[currentEnvOffset].index);
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
        });
        Object.keys(buildFlags).forEach(key => {
            self[key] = buildFlags[key];
        });
        Object.keys(this).forEach(key => {
            console.log('toml:', key, this[key]);
        });
        if(!this.s3_bucket && this.s3_bucket_parm) {
            logger.info('Loading bucket from parameter', this.region, buildFlags);
            const ssm = new SSM({ region: this.region });
            try {
                const parm = await ssm.getParameter({
                    Name: this.s3_bucket_parm
                });
                if(parm) {
                    this.s3_bucket = parm.Parameter.Value;
                }
            } catch (err) {
                logger.error(err);
                logger.warn('Bucket param could not be retrieved');
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
                this.dev_stack = `-${addToStack}`;
                this.stack_name = `${this.stack_name}-${addToStack}`;
                logger.warn('Setting up developer isolated stack', this.stack_name);
            }
        }

        if(this.region) {
            process.env.AWS_REGION = this.region;
        }
    }
}

const samconfig = new SAMConfig();
module.exports.samconfig = samconfig;
module.exports.SAMConfig = SAMConfig;
