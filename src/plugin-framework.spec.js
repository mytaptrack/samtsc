const { PluginFramework } = require('./plugin-framework');

const execSync = jest.fn();
const pluginFramework = new PluginFramework({ env: true }, true);

describe('plugin-framework', () => {
    beforeEach(() => {
        execSync.mockReset();
        pluginFramework.execSync = execSync;
    });

    test('no scripts', () => {
        pluginFramework.rootPackage = {};
        pluginFramework.preCopyIncludes();
        expect(execSync).toBeCalledTimes(0);
    });

    test('no scripts to call', () => {
        pluginFramework.rootPackage = { scripts: { 'build': 'nothing'}};
        pluginFramework.preCopyIncludes();
        pluginFramework.postCopyIncludes();
        pluginFramework.preTemplateLoad();
        pluginFramework.postTemplateLoad();
        expect(execSync).toBeCalledTimes(0);
    });

    test('script pre-copy-includes', () => {
        pluginFramework.rootPackage = { scripts: {
            'samtsc-pre-copy-includes': 'echo test'
        }};
        pluginFramework.preCopyIncludes();
        expect(execSync).toBeCalledWith(`npm run samtsc-pre-copy-includes`, {
                env: {
                    config: JSON.stringify({env:true})
                }
            });
    });

    test('do not call script post-copy-includes', () => {
        pluginFramework.rootPackage = { scripts: {
            'samtsc-post-copy-includes': 'echo test'
        }};
        pluginFramework.preCopyIncludes();
        expect(execSync).toBeCalledTimes(0);
    });

    test('script post-copy-includes', () => {
        pluginFramework.rootPackage = { scripts: {
            'samtsc-post-copy-includes': 'echo test'
        }};
        pluginFramework.postCopyIncludes();
        expect(execSync).toBeCalledWith(`npm run samtsc-post-copy-includes`, {
                env: {
                    config: JSON.stringify({env:true})
                }
            });
    });

    test('script pre-template-load', () => {
        pluginFramework.rootPackage = { scripts: {
            'samtsc-pre-template-load': 'echo test'
        }};
        pluginFramework.preTemplateLoad();
        expect(execSync).toBeCalledWith(`npm run samtsc-pre-template-load`, {
                env: {
                    config: JSON.stringify({env:true})
                }
            });
    });

    test('script post-template-load', () => {
        pluginFramework.rootPackage = { scripts: {
            'samtsc-post-template-load': 'echo test'
        }};
        pluginFramework.postTemplateLoad();
        expect(execSync).toBeCalledWith(`npm run samtsc-post-template-load`, {
                env: {
                    config: JSON.stringify({env:true})
                }
            });
    });
});