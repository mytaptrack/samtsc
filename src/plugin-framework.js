const { execSync } = require('child_process');
const { readFileSync } = require('./file-system');

class PluginFramework {
    constructor(config, skipPackageLoad) {
       this.config = config;
       if(!skipPackageLoad) {
        this.rootPackage = JSON.parse(readFileSync('package.json').toString().replace(/\/\/.*/g, ''));
       }
       this.execSync = execSync;
    }

    runHook(hookName) {
        if(this.rootPackage && this.rootPackage.scripts &&
            this.rootPackage.scripts['samtsc-' + hookName]) {
            this.execSync(`npm run samtsc-${hookName}`, {
                env: {
                    config: JSON.stringify(this.config)
                }
            });
        }
    }
    preTemplateLoad() { this.runHook('pre-template-load'); }
    postTemplateLoad() { this.runHook('post-template-load'); }
    preCopyIncludes() { this.runHook('pre-copy-includes'); }
    postCopyIncludes() { this.runHook('post-copy-includes'); }
}

module.exports.PluginFramework = PluginFramework;