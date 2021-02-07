const { existsSync, readFileSync, writeFileSync } = require('../file-system');

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
        this.load({});
    }

    save() {
        writeFileSync(`${this.buildRoot}/samconfig.toml`,
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

const samconfig = new SAMConfig();
module.exports.samconfig = samconfig;
