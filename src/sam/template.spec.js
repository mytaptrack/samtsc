// const { samconfig } = require('./samconfig');
const { existsSync, touch } = require('../file-system');
const { origin, setupTestEnvironment, buildRoot } = require('../test-utils');
const { SAMTemplate } = require('./template');

const samconfig = { no_deploy: true, stack_reference_layer: "stackLayer", save: () => {} };

describe('System: template', () => {
    afterEach(() => {
        process.chdir(origin);
    });
    describe('SAMTemplate', () => {
        beforeEach(() => {
            setupTestEnvironment();
        });

        test('Load and build first time', async () => {
            const template = new SAMTemplate('template.yml', buildRoot, samconfig);
            try {
                await template.reload()
                
                expect(existsSync('.build/hash/src-library')).toBeTruthy();
                expect(existsSync('.build/hash/src-function1')).toBeTruthy();
                expect(existsSync('.build/hash/src-function2')).toBeTruthy();
            } catch (err) {
                console.log(err);
            } finally {
                template.cleanup();
            }
        });

        test('Load template in subdir', async () => {
            const template = new SAMTemplate('subdir/template.yml', buildRoot, samconfig);
            try {
                await template.reload();
                
                expect(existsSync('.build/hash/src-subdir-function1')).toBeTruthy();
            } catch (err) {
                console.log(err);
            } finally {
                template.cleanup();
            }
        });

        test('Load twice', async () => {
            jest.setTimeout(3 * 60 * 1000);
            let function1Dir;
            let function2Dir;
            let libDir;

            const template = new SAMTemplate('template.yml', buildRoot, samconfig);
            try {
                await template.reload();

                expect(existsSync('.build/hash/src-library')).toBeTruthy();
                expect(existsSync('.build/hash/src-function1')).toBeTruthy();
                expect(existsSync('.build/hash/src-function2')).toBeTruthy();

                function1Dir = template.compiledDirectories['src/function1'];
                function2Dir = template.compiledDirectories['src/function2'];
                libDir = template.compiledDirectories['src/library'];
                await new Promise((resolve) => {
                    let eventOccurred = false;
                    template.events.on('template-update', () => {
                        eventOccurred = true;
                        resolve();
                    });
                    touch('template.yml');
                    template.fileEvent('template.yml');
                });
                
                expect(function1Dir).toBe(template.compiledDirectories['src/function1']);
                expect(function2Dir).toBe(template.compiledDirectories['src/function2']);
                expect(libDir).toBe(template.compiledDirectories['src/library']);

                const func1 = template.functions.find(x => x.name == 'function1');

                await new Promise((resolve) => {
                    let eventOccurred = false;
                    func1.events.on('deploy-complete', () => {
                        eventOccurred = true;
                        resolve();
                    });
                    touch('src/function1/index.ts');
                    template.fileEvent('src/function1/index.ts');
                });
                
                expect(existsSync('.build/root/src/function1/src')).toBeFalsy();
            } finally {
                template.cleanup();
            }
        }, 30 * 60 * 1000);
    });
});
