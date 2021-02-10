console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { execOnlyShowErrors } = require('./tsc-tools');
const { mkdir } = require('./file-system');
const { logger } = require('./logger');
const { samconfig } = require('./sam/samconfig');
const { SAMTemplate } = require('./sam/template');

const tempDir = "./.build/tmp";
mkdir(tempDir);

logger.loadConfig(samconfig);

console.debug = (...params) => {
    if(samconfig.debug) {
        console.log('samtsc:', ...params);
    }
}

let buildRoot;
module.exports.setBuildRoot = (rootPath) => {
    buildRoot = rootPath;
}

class SAMFramework {
    constructor(path, buildRootDir, flags) {
        console.log('samtsc: Loading Framework');
        const self = this;
        samconfig.load(flags, buildRootDir);

        buildRoot = buildRootDir;
        this.buildRoot = buildRoot;
        this.path = path;
    }

    async load() {
        this.template = new SAMTemplate(this.path, buildRoot, samconfig);
        await this.template.reload();

        if(samconfig.skip_init_deploy != 'true') {
            this.templateUpdated();
        }

        const self = this;
        this.template.events.on('layer-change', (source) => { self.templateUpdated(source) });
        this.template.events.on('template-update', (source) => { self.templateUpdated(); } )
    }

    templateUpdated() {
        try {
            console.log('samtsc: Building SAM deployment');
            execSync(`sam build`, { cwd: buildRoot, stdio: 'inherit' });
            console.log('samtsc: Completed building SAM deployment, deploying with SAM');
            if (samconfig.build_only != 'true') {
                let parameters = '--no-fail-on-empty-changeset --no-confirm-changeset';
                let paramOverrides = [];
                if(samconfig.base_stack) {
                    paramOverrides.push(`StackName=${samconfig.base_stack}`, `EnvironmentTagName=${samconfig.environment}`);
                }
                Object.keys(this.template.parameters).forEach(k => {
                    if(k == 'StackName' || k =='EnvironmentTagName') {
                        return;
                    }
                    const defaultVal = this.template.parameters[k].Default;
                    if(defaultVal) {
                        paramOverrides.push(`${k}=${defaultVal}`);
                    }
                });
                if(paramOverrides) {
                    parameters = `${parameters} --parameter-overrides ${paramOverrides.join(' ')}`;
                }

                execSync(`sam deploy ${parameters}`, { cwd: buildRoot, stdio: 'inherit' });
                console.log('samtsc: deploy complete, waiting for file change');
            }
        } catch (err) {
            console.log(err);
        }
    }
}

module.exports.SAMFramework = SAMFramework;