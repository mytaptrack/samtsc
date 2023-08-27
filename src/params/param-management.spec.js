//
// Remove aws sdk from being used in unit tests
//
const aws = require('@aws-sdk/client-ssm');

let paramRetval = [];
const getParameters = jest.fn();
const getParameter = jest.fn();
const putParameter = jest.fn();
const deleteParameter = jest.fn();
const describeParameters = jest.fn();

function resetMocks() {
    jest.resetAllMocks();
    getParameters.mockImplementation(() => {
        return {
            promise: async () => {
                return {
                    Parameters: paramRetval
                };
            }
        };
    });

    putParameter.mockImplementation(() => {
        return {
            promise: async () => {}
        };
    });

    deleteParameter.mockImplementation(() => {
        return {
            promise: async () => {}
        };
    });

    describeParameters.mockImplementation(() => {
        return {
            promise: async () => {
                return {
                    Parameters: paramRetval
                }
            }
        }
    });

    getParameter.mockImplementation((request) => {
        return {
            promise: async () => {
                return {
                    Parameter: {
                        Value: paramRetval.find(x => x.Name == request.Name).Value
                    }
                }
            }
        }
    });
}

class SSM {
    constructor() {
        this.getParameters = getParameters;
        this.getParameter = getParameter;
        this.putParameter = putParameter;
        this.deleteParameter = deleteParameter;
        this.describeParameters = describeParameters;
    }
}
aws.SSM = SSM;
const mgt = require('./param-management');

describe('params', () => {
    describe('param-management', () => {
        describe('setKey', () => {
            beforeEach(() => { 
                resetMocks(); 
            });
            test('Key as JSON', () => {
                const val = {};
                mgt.paramsSetKey(val, ['key'], '{ "test":"val" }');
                expect(val.key.test).toBe('val');
            });
    
            test('Key as string', () => {
                const val = {};
                mgt.paramsSetKey(val, ['key'], '{ "test":"val"');
                expect(val.key).toBe('{ "test":"val"');
            });
    
            test('Key overwrite', () => {
                const val = {};
                mgt.paramsSetKey(val, ['key'], '{ "test":"val" }');
                expect(val.key.test).toBe('val');
                mgt.paramsSetKey(val, ['key', 'test'], 'val2');
                expect(val.key.test).toBe('val2');
            });    
        });
        describe('ssmParamsToObj', () => {
            beforeEach(() => { 
                resetMocks(); 
            });
            test('Complex Object', async () => {
                paramRetval = [
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } }, "second": "value" }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/path/to/val', Value: 'Test' },
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } } }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/second', Value: 'value' }
                ];

                const object = await mgt.ssmParamsToObj({});

                expect(object.test.path.to.val).toBe('Test');
                expect(object.test.second).toBe('value');
            });

            test('Complex Object w/ Mismatching values', async () => {
                paramRetval = [
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } }, "second": "value" }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/path/to/val', Value: 'Overwritten value' },
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } } }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/second', Value: 'This is a new value' }
                ];

                const object = await mgt.ssmParamsToObj({});

                expect(object.test.path.to.val).toBe('Overwritten value');
                expect(object.test.second).toBe('This is a new value');
            });
        });
        describe('ssmParamsToYaml', () => {
            beforeEach(() => { resetMocks(); });
            test('Complex Object', async () => {
                paramRetval = [
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } }, "second": "value" }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/path/to/val', Value: 'Overwritten value' },
                    { Name: '/test/second', Value: 'This is a new value' }
                ];

                const object = await mgt.ssmParamsToYaml({ params_keys: undefined }, true);

                expect(object.indexOf('Overwritten value') >= 0).toBeTruthy();
                expect(object.indexOf('This is a new value') >= 0).toBeTruthy();
            });

            test('Complex Object w/ paths', async () => {
                paramRetval = [
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test First" } }, "second": "Test Value" }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test First" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test First" }' },
                    { Name: '/test/path/to/val', Value: 'Test First' },
                    { Name: '/test/second', Value: 'Test Value' }
                ];

                const object = await mgt.ssmParamsToYaml({ params_keys: '/test/path'}, true);

                expect(object.indexOf('Test') >= 0).toBeTruthy();
                expect(object.indexOf('Test Value') == -1).toBeTruthy();
            });

            test('Complex Object w/ overwrites', async () => {
                paramRetval = [
                    { Name: '/test', Value: '{ "path": { "to": { "val": "Test" } }, "second": "Test Value" }' },
                    { Name: '/test/path', Value: '{ "to": { "val": "Test" } }' },
                    { Name: '/test/path/to', Value: '{ "val": "Test" }' },
                    { Name: '/test/path/to/val', Value: 'Overwritten value' },
                    { Name: '/test/second', Value: 'This is a new value' }
                ];

                const object = await mgt.ssmParamsToYaml({ params_keys: '/test/path,/test/second'}, true);

                expect(object.indexOf('Overwritten value') >= 0).toBeTruthy();
                expect(object.indexOf('This is a new value') >= 0 ).toBeTruthy();
                expect(object.indexOf('Test Value') == -1 ).toBeTruthy();
            });
        });
        describe('readParamConfigs', () => {
            beforeEach(() => { resetMocks(); });
            test('Read dev env', () => {
                const object = mgt.readParamConfigs('samples/param_config', 'dev', 'us-west-2');
                expect(object.env.integration.server).toBe('127.0.0.1');
                expect(object.env.regions).toMatchObject(['us-west-1','us-west-2']);
                expect(object.env.overwrite).toBe('post-value-1');
                expect(object.defaults.value1).toBe('this is a test');
                expect(object.env.regional.value).toBe('regional value');
                expect(object.defaults.value2).toBe(200);
            });

            test('Read tst env', () => {
                const object = mgt.readParamConfigs('samples/param_config', 'tst', 'us-west-2');
                expect(object.env.integration.server).toBe('127.0.0.2');
                expect(object.env.regions).toMatchObject(['us-west-1','us-west-2']);
                expect(object.env.overwrite).toBe('post-value-2');
                expect(object.defaults.value1).toBe('this is a test');
                expect(object.defaults.value2).toBe(200);
            });

            test('Env file does not exist', () => {

                const object = mgt.readParamConfigs('samples/param_config', 'foo', 'us-west-2');
                expect(object.env.integration).toBeUndefined();
                expect(object.env.overwrite).toBe('pre-value');
                expect(object.env.regions).toMatchObject(['us-west-1','us-west-2']);
                expect(object.defaults.value1).toBe('this is a test')
                expect(object.defaults.value2).toBe(200)
            });

            test('Directory does not exist', () => {
                const object = mgt.readParamConfigs('samples/param_config_does_not_exist', 'foo', 'us-west-2');
                expect(object.env).toBeUndefined();
                expect(object.defaults).toBeUndefined();
            });
        });
        describe('mergeFilesWithEnv', () => {
            beforeEach(() => { 
                resetMocks(); 
            });
            test('All new', async () => {
                paramRetval = [];
                
                await mgt.mergeFilesWithEnv({ environment: 'dev', params_dir: 'samples/param_config', params_clean: true });
                expect(putParameter).toBeCalledTimes(9);
            });

            test('Add new vars', async () => {
                paramRetval = [
                    { Name: '/defaults', Value: '{"value1": "this is a test", "value2": 200}' },
                    { Name: '/defaults/value1', Value: 'this is a test' },
                    { Name: '/defaults/value2', Value: '200' }
                ];

                await mgt.mergeFilesWithEnv({ environment: 'dev', params_dir: 'samples/param_config' });
                expect(putParameter).toBeCalledTimes(6);
            });

            test('No new vars', async () => {
                paramRetval = [
                    { Name: '/defaults', Value: '{"value1": "this is a test", "value2": 200}' },
                    { Name: '/defaults/value1', Value: 'this is a test' },
                    { Name: '/defaults/value2', Value: '200' },
                    { Name: '/dev', Value: '{ "integration": {"server": "127.0.0.1", "port": 8000}, "overwrite":"post-value-1", "regions": ["us-west-1", "us-west-2"]}'},
                    { Name: '/dev/integration', Value: '{"server": "127.0.0.1", "port": 8000}'},
                    { Name: '/dev/integration/server', Value: '127.0.0.1'},
                    { Name: '/dev/integration/port', Value: '8000'},
                    { Name: '/dev/overwrite', Value: 'post-value-1'},
                    { Name: '/dev/regions', Value: '["us-west-1", "us-west-2"]'},
                ];

                await mgt.mergeFilesWithEnv({ environment: 'dev', params_dir: 'samples/param_config' });
                expect(putParameter).toBeCalledTimes(0);
            });

            test('Remove vars', async () => {
                paramRetval = [
                    { Name: '/defaults', Value: '{"value1": "this is a test", "value2": 200}' },
                    { Name: '/defaults/value1', Value: 'this is a test' },
                    { Name: '/defaults/value2', Value: '200' },
                    { Name: '/defaults/value3', Value: '400' },
                    { Name: '/dev', Value: '{ "integration": {"server": "127.0.0.1", "port": 8000}, "overwrite":"post-value-1", "regions": ["us-west-1", "us-west-2"]}'},
                    { Name: '/dev/integration', Value: '{"server": "127.0.0.1", "port": 8000}'},
                    { Name: '/dev/integration/server', Value: '127.0.0.1'},
                    { Name: '/dev/integration/port', Value: '8000'},
                    { Name: '/dev/overwrite', Value: 'post-value-1'},
                    { Name: '/dev/regions', Value: '["us-west-1", "us-west-2"]'},
                ];

                await mgt.mergeFilesWithEnv({ environment: 'dev', params_dir: 'samples/param_config', params_keys: '/defaults', params_clean: 'true' });
                expect(putParameter).toBeCalledTimes(1); // The update to the /defaults rollup of parameters
                expect(deleteParameter).toBeCalledTimes(1);
            });

            test('Dont remove vars', async () => {
                paramRetval = [
                    { Name: '/defaults', Value: '{"value1": "this is a test", "value2": 200}' },
                    { Name: '/defaults/value1', Value: 'this is a test' },
                    { Name: '/defaults/value2', Value: '200' },
                    { Name: '/defaults/value3', Value: '400' },
                    { Name: '/dev', Value: '{ "integration": {"server": "127.0.0.1", "port": 8000}, "overwrite":"post-value-1", "regions": ["us-west-1", "us-west-2"]}'},
                    { Name: '/dev/integration', Value: '{"server": "127.0.0.1", "port": 8000}'},
                    { Name: '/dev/integration/server', Value: '127.0.0.1'},
                    { Name: '/dev/integration/port', Value: '8000'},
                    { Name: '/dev/overwrite', Value: 'post-value-1'},
                    { Name: '/dev/regions', Value: '["us-west-1", "us-west-2"]'},
                ];

                await mgt.mergeFilesWithEnv({ environment: 'dev', params_dir: 'samples/param_config', params_keys: '/defaults', params_clean: 'false' });
                expect(putParameter).toBeCalledTimes(0); // The update to the /defaults rollup of parameters
                expect(deleteParameter).toBeCalledTimes(0);
            });
        });
    });
});