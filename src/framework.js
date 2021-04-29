console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { execOnlyShowErrors } = require('./tsc-tools');
const { mkdir, watch, existsSync, symlinkSync } = require('./file-system');
const { logger } = require('./logger');
const { samconfig } = require('./sam/samconfig');
const { SAMTemplate } = require('./sam/template');
const { copyFolder } = require('./file-system');
const { resolve, relative } = require('path');

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
        samconfig.save();

        buildRoot = buildRootDir;
        this.buildRoot = buildRoot;
        this.path = path;
    }

    async load() {
        this.template = new SAMTemplate(this.path, buildRoot, samconfig);
        await this.template.reload();

        if(samconfig.include_in_builddir) {
            if(!existsSync('.build/root')) {
                mkdir('.build/root');
            }
            samconfig.include_in_builddir = samconfig.include_in_builddir.split(',');
            samconfig.include_in_builddir.forEach((x, i) => {
                if(!x) {
                    return;
                }

                const source = resolve(x);
                const dest = resolve('.build/root', x);

                if(!existsSync(source)) {
                    return;
                }

                const relativePath = relative(resolve('.'), source);
                samconfig.include_in_builddir[i] = relativePath;

                copyFolder(source, dest);
            });
        }

        if(samconfig.skip_init_deploy != 'true') {
            this.templateUpdated();
        }

        const self = this;
        this.template.events.on('layer-change', (source) => { self.templateUpdated(source) });
        this.template.events.on('template-update', (source) => { self.templateUpdated(); } )

        if(!samconfig.build_only && !samconfig.deploy_only) {
            this.watcher = watch('.', { recursive: true }, (event, filename) => {
                this.template.fileEvent(filename);

                if(samconfig.include_in_builddir) {
                    let modified = false;
                    samconfig.include_in_builddir.forEach(x => {
                        if(!filename.startsWith(x)) {
                            return;
                        }
        
                        const source = resolve(x);
                        const dest = resolve('.build/root', x);
        
                        if(!existsSync(source)) {
                            return;
                        }
        
                        copyFolder(source, dest);
                        modified = true;
                    });

                    if(modified) {
                        self.templateUpdated();
                    }
                }
            });
        }
    }

    templateUpdated() {
        try {
            logger.info('Validating SAM template');
            execSync('sam validate', { cwd: buildRoot, stdio: 'inherit' });

            logger.info('Building SAM deployment');
            execSync(`sam build`, { cwd: buildRoot, stdio: 'inherit' });
            if(!samconfig.minimal_deploy) {
                const source = resolve(buildRoot, '.aws-sam');
                const dest = resolve('.aws-sam');
                logger.info('Copying sam files for use at root', source, dest);
                copyFolder(source, dest);
            }

            console.log('samtsc: Completed building SAM deployment, deploying with SAM');
            if (samconfig.build_only != 'true') {
                let parameters = `--no-fail-on-empty-changeset --no-confirm-changeset --s3-bucket ${samconfig.s3_bucket}`;
                let paramOverrides = [];
                if(samconfig.base_stack) {
                    if(this.template.parameters.StackName) {
                        paramOverrides.push(`StackName=${samconfig.base_stack}`);
                    }
                    if(this.template.parameters.StackTagName) {
                        paramOverrides.push(`StackTagName=${samconfig.base_stack}`);
                    }
                    if(this.template.parameters.EnvironmentName) {
                        paramOverrides.push(`EnvironmentName=${samconfig.environment}`);
                    }
                    if(this.template.parameters.EnvironmentTagName) {
                        paramOverrides.push(`EnvironmentTagName=${samconfig.environment}`);
                    }
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
            if(samconfig.deploy_only || samconfig.build_only) {
                throw err;
            } else {
                console.log(err);
            }
        }
    }
}

module.exports.SAMFramework = SAMFramework;