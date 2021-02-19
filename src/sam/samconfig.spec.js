const testUtils = require('../test-utils/index');
const { SAMConfig } = require('./samconfig');

describe('samconfig', () => {    
    test('Load And Override', () => {
        process.chdir('samples/stack_layer');
        const samconfig = new SAMConfig();
        expect(samconfig.environment).toBe('test');
        samconfig.load({ environment: 'prod' }, '.build/root');
        expect(samconfig.environment).toBe('prod');
        expect(samconfig.stack_name).toBe('sample-stack-layer-prod');
    });
});