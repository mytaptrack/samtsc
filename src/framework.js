console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { execOnlyShowErrors } = require('./tsc-tools');
const { mkdir, watch, existsSync, symlinkSync, readFileSync, copyFileSync } = require('./file-system');
const { logger } = require('./logger');
const { samconfig } = require('./sam/samconfig');
const { SAMTemplate } = require('./sam/template');
const { copyFolder } = require('./file-system');
const { resolve, relative } = require('path');
const { PluginFramework } = require('./plugin-framework');

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
        
        this.loadPromise = samconfig.load(flags, buildRootDir);
        this.pluginFramework = new PluginFramework(samconfig);
        this.loadPromise.then(() => {
            samconfig.save();
        });

        buildRoot = buildRootDir;
        this.buildRoot = buildRoot;
        this.path = path;
    }

    async load() {
        await this.loadPromise;
        this.pluginFramework.preTemplateLoad();
        this.template = new SAMTemplate(this.path, buildRoot, samconfig, samconfig.stack_name);
        await this.template.reload();
        this.pluginFramework.postTemplateLoad();

        if(samconfig.include_in_builddir) {
            if(!existsSync('.build/root')) {
                mkdir('.build/root');
            }
            this.pluginFramework.preCopyIncludes();
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
            this.pluginFramework.postCopyIncludes();
        }

        if(samconfig.skip_init_deploy != 'true') {
            this.templateUpdated();
        }

        if(!samconfig.build_only && !samconfig.package && !samconfig.deploy_only) {
            const self = this;
            this.template.events.on('layer-change', (source) => { 
                logger.debug('Layer Updated', source);
                self.templateUpdated(source);
            });
            this.template.events.on('template-update', (source) => { 
                logger.debug('Template Updated', source);
                self.templateUpdated(); 
            } )
    
            this.watcher = watch('.', { recursive: true }, (event, filename) => {
                logger.debug('Watcher file event', filename);
                const ignore = this.template.fileEvent(filename);

                if(samconfig.include_in_builddir) {
                    logger.debug('Evaluating include files');
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
        
                        this.pluginFramework.preCopyIncludes();
                        copyFolder(source, dest);
                        this.pluginFramework.postCopyIncludes();
                        modified = true;
                    });

                    logger.debug('Evaluating template reload', modified, ignore);
                    if(modified && !ignore) {
                        self.templateUpdated();
                    }
                }
            });
        }

        if(samconfig.package) {
            const outputDir = 'dist/cloudformation';
            mkdir(outputDir);
            
            const environments = samconfig.package && samconfig.environments? samconfig.environments.split(',') : [samconfig.environment];
            environments.forEach(env => {
                copyFileSync(resolve(this.buildRoot, `template-${env}.config`), `dist/cloudformation/template-${env}.config`);
            });

            let postfix = '';
            if(samconfig.region_postfix) {
                postfix = '-' + samconfig.region;
            }
            let parameters = `--s3-bucket ${samconfig.s3_bucket} --s3-prefix ${samconfig.s3_prefix} --output-template-file ../../${outputDir}/template${postfix}.yaml`;
            
            if(samconfig.region) {
                parameters += ` --region ${samconfig.region}`;
            }

            logger.info('packaging');
            const execCommand = `sam package ${parameters}`;
            logger.debug(execCommand);
            execSync(execCommand, { cwd: buildRoot, stdio: 'inherit' });
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
            if (samconfig.build_only != 'true' && samconfig.build_only != true && !samconfig.package ) {
                let parameters = `--no-fail-on-empty-changeset --s3-bucket ${samconfig.s3_bucket}`;
                let paramOverrides = [];
                const envConf = this.template.templateConfigurations.find(x => x.Tags.environment == samconfig.environment);
                logger.debug('Env Config', samconfig.environment, JSON.stringify(envConf));
                const params = envConf? envConf.Parameters || {} : {};

                if(samconfig.base_stack) {
                    if(params.StackName) {
                        paramOverrides.push(`StackName=${samconfig.base_stack}`);
                    }
                    if(params.StackTagName) {
                        paramOverrides.push(`StackTagName=${samconfig.base_stack}`);
                    }
                    if(params.EnvironmentName) {
                        paramOverrides.push(`EnvironmentName=${samconfig.environment}`);
                    }
                    if(params.EnvironmentTagName) {
                        paramOverrides.push(`EnvironmentTagName=${samconfig.environment}`);
                    }
                }
                Object.keys(params).forEach(k => {
                    if(k == 'StackName' || k =='EnvironmentTagName') {
                        return;
                    }
                    const defaultVal = params[k];
                    if(defaultVal) {
                        paramOverrides.push(`"${k}=${defaultVal}"`);
                    }
                });
                if(paramOverrides && paramOverrides.length > 0) {
                    parameters = `${parameters} --parameter-overrides ${paramOverrides.join(' ')}`;
                }

                logger.info('deploying');
                execSync(`sam deploy ${parameters}`, { cwd: buildRoot, stdio: 'inherit' });
                console.log('samtsc: deploy complete, waiting for file change');
            }
        } catch (err) {
            if(samconfig.deploy_only || samconfig.build_only || samconfig.package) {
                throw err;
            } else {
                console.log(err);
            }
        }
    }
}

module.exports.SAMFramework = SAMFramework;