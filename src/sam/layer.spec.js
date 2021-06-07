const fs = require('../file-system');
const cp = require('child_process');
const existsSync = jest.fn();
const writeFileSync = jest.fn();
const readFileSync = jest.fn();
const execSync = jest.fn();
const mkdir = jest.fn();
const originalExistsSync = fs.existsSync;
const originalWriteFileSync = fs.writeFileSync;
const originalMkdir = fs.mkdir;
const originalReadFileSync = fs.readFileSync;
const originalExecSync = cp.execSync;
const { logger } = require('../logger');

logger.samconfig = {};


describe('Unit: SAMLayer', () => {
    describe('Construct packages', () => {
        beforeEach(() => {
            jest.resetAllMocks();
            fs.existsSync = existsSync;
            fs.writeFileSync = writeFileSync;
            fs.mkdir = mkdir;
            fs.readFileSync = readFileSync;
            cp.execSync = execSync;
        });
        afterEach(() => {
            fs.existsSync = originalExistsSync;
            fs.writeFileSync = originalWriteFileSync;
            fs.mkdir = originalMkdir;
            fs.readFileSync = originalReadFileSync;
            cp.execSync = originalExecSync;
        });
        test('Basic Layer', () => {
            const { SAMLayer } = require('./layer');
            existsSync.mockReturnValue(true);
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0'
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                "name": "samtsc",
                "version": "1.0.49",
                "lockfileVersion": 1,
                "requires": true
            }));
            const layer = new SAMLayer('src-layer', { ContentUri: 'src/layer' }, { BuildMethod: 'nodejs12.x'}, 'test-stack', '.', { debug: true });
            expect(layer.sourcePath).toBe('src/layer');
            expect(layer.libs.length).toBe(0);
            expect(execSync).toBeCalledTimes(0);
            expect(writeFileSync).toBeCalledTimes(2);
        });
        test('Layer w/ library', () => {
            const { SAMLayer } = require('./layer');
            existsSync.mockReturnValue(true);
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0',
                dependencies: {
                    'library': 'file:../library'
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                "name": "samtsc",
                "version": "1.0.49",
                "lockfileVersion": 1,
                "requires": true,
                dependencies: {
                    'library': {
                        version: 'file:../library'
                    }
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({}));
            const layer = new SAMLayer('src-layer', { ContentUri: 'src/layer' }, { BuildMethod: 'nodejs12.x'}, 'test-stack', '.', { debug: true });
            expect(layer.sourcePath).toBe('src/layer');
            expect(layer.libs.length).toBe(1);
            expect(layer.libs[0].path).toBe('src/library');
            expect(writeFileSync).toBeCalledTimes(2);
        });
        test('Stack Layer w/ library', () => {
            const { SAMLayer } = require('./layer');
            existsSync.mockReturnValue(true);
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0',
                dependencies: {
                    'library': 'file:../library'
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                "name": "samtsc",
                "version": "1.0.49",
                "lockfileVersion": 1,
                "requires": true,
                dependencies: {
                    'library': {
                        version: 'file:../library'
                    }
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0',
                dependencies: {
                    'library2': 'file:src/library2'
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({}));
            readFileSync.mockReturnValueOnce(JSON.stringify({}));
            const layer = new SAMLayer('src-layer', { ContentUri: 'src/layer' }, { BuildMethod: 'nodejs12.x'}, 'test-stack', '.', { debug: true, stack_reference_layer: 'src-layer' });
            expect(layer.sourcePath).toBe('src/layer');
            expect(layer.libs.length).toBe(2);
            expect(layer.libs[0].path).toBe('src/library');
            expect(layer.libs[1].path).toBe('src/library2');
            expect(writeFileSync).toBeCalledTimes(1);
        });
        test('Root Layer w/ library', () => {
            const { SAMLayer } = require('./layer');
            existsSync.mockReturnValue(true);
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0',
                dependencies: {
                    'library': 'file:src/library'
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                "name": "samtsc",
                "version": "1.0.49",
                "lockfileVersion": 1,
                "requires": true,
                dependencies: {
                    'library': {
                        version: 'file:src/library'
                    }
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({}));
            const layer = new SAMLayer('src-layer', { ContentUri: '.' }, { BuildMethod: 'nodejs12.x'}, 'test-stack', '.', { debug: true });
            expect(layer.sourcePath).toBe('.');
            expect(layer.libs.length).toBe(1);
            expect(layer.libs[0].path).toBe('src/library');
            expect(writeFileSync).toBeCalledTimes(2);
        });

        test('Root Layer w/ non-standard library', () => {
            const { SAMLayer } = require('./layer');
            existsSync.mockReturnValue(true);
            readFileSync.mockReturnValueOnce(JSON.stringify({
                name: 'stack-layer',
                version: '1.0.0',
                dependencies: {
                    'library': 'file:api/library'
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({
                "name": "samtsc",
                "version": "1.0.49",
                "lockfileVersion": 1,
                "requires": true,
                dependencies: {
                    'library': {
                        version: 'file:api/library'
                    }
                }
            }));
            readFileSync.mockReturnValueOnce(JSON.stringify({}));
            const layer = new SAMLayer('src-layer', { ContentUri: '.' }, { BuildMethod: 'nodejs12.x'}, 'test-stack', '.', { debug: true });
            expect(layer.pck.dependencies.library).toBe('file:../../../../api/library');
            expect(layer.sourcePath).toBe('.');
            expect(layer.libs.length).toBe(1);
            expect(layer.libs[0].path).toBe('api/library');
            expect(writeFileSync).toBeCalledTimes(2);
        });
    });
});
