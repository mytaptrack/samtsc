const aws = require('@aws-sdk/client-ssm');
const yaml = require('yaml');
const fs = require('../file-system');
const path = require('path');
const _ = require('lodash');
const { existsSync, mkdirSync } = require('fs');
const { logger } = require('../logger');
const { samconfig } = require('../sam/samconfig');

function setKey(obj, keyParts, value) {
    if(keyParts.length < 1 || !value) {
        return;
    }

    const key = keyParts[0];
    if(keyParts.length > 1) {
        if(!obj[key]) {
            obj[key] = {};
        }
        setKey(obj[key], keyParts.slice(1), value);
    } else {
        try {
            obj[key] = JSON.parse(value);
        } catch (err) {
            obj[key] = value;
        }
    }
}

function setObjKey(obj, keyParts, value) {
    if(keyParts.length < 1) {
        return;
    }

    const key = keyParts[0];
    if(keyParts.length > 1) {
        if(!obj[key]) {
            obj[key] = {};
        }
        setObjKey(obj[key], keyParts.slice(1), value);
        return;
    }
    obj[key] = value;
}

function getKey(obj, keyParts) {
    if(keyParts.length < 1) {
        return;
    }

    const key = keyParts[0];
    if(obj[key]) {
        if(keyParts.length > 1) {
            return getKey(obj[key], keyParts.slice(1));
        } else {
            return obj[key];
        }
    } else {
        return;
    }
}

function deleteKey(obj, keyParts) {
    if(keyParts.length < 1) {
        return;
    }

    const key = keyParts[0];
    if(obj[key]) {
        if(keyParts.length > 1) {
            deleteKey(obj[key], keyParts.slice(1));
        } else {
            delete obj[key];
        }
    } else {
        return;
    }
}

async function ssmParamsToObj(samconfig) {
    const ssm = new aws.SSM({ region: samconfig.region });
    let token;
    const parameters = [];
    do {
        const awsResults = await ssm.describeParameters( {
            NextToken: token
        });
        token = awsResults.NextToken;
        parameters.push(...awsResults.Parameters)
    } while (token);
    
    parameters.sort((a, b) => a.Name.localeCompare(b.Name));

    const retval = {};
    await Promise.all(parameters.map(async x => {
        if(!x.Name || !x.Name.startsWith('/')) {
            return;
        }
        const parts = x.Name.slice(1).split('/');
        const param = await ssm.getParameter({
            Name: x.Name
        });
        setKey(retval, parts, param.Parameter.Value);
    }));

    return retval;
}

async function ssmParamsToYaml(samconfig, skipWrite) {
    const paramKeys = samconfig.params_keys? samconfig.params_keys.split(',') : undefined;
    let retval = await ssmParamsToObj(samconfig);
    if (paramKeys) {
        logger.info('Filtering data to specific keys', paramKeys);
        const old = retval;
        retval = {};
        logger.info('Processing keys');
        for(let key of paramKeys) {
            const readParts = key.replace(/\/env\//g, `/${samconfig.environment}/`).slice(1).split('/').filter(x => x? true : false);
            const writeParts = key.slice(1).split('/').filter(x => x? true : false);
            const value = getKey(old, readParts);
            logger.debug('Setting value', writeParts, value);
            setObjKey(retval, writeParts, value);
            logger.debug('Value set', retval);
        }
        logger.info('Finished processing keys');
    }

    const data = yaml.stringify(retval);

    if(!skipWrite) {
        let outputPath = samconfig.params_output || samconfig.params_dir;

        if(!samconfig.params_output.endsWith('.yml') && !samconfig.params_output.endsWith('.yaml')) {
            if(!existsSync(samconfig.params_output)) {
                mkdirSync(samconfig.params_output);
            }
            outputPath = path.resolve(samconfig.params_output, `params_${samconfig.environment}.yml`);
        }
        fs.writeFileSync(outputPath, data);
    }

    return data;
}

function readParamConfigs(sourceDir, environment, region) {
    let genericPath = '';
    if(sourceDir.endsWith('.yml' || sourceDir.endsWith('yaml'))) {
        genericPath = sourceDir;
    } else if (fs.existsSync(path.resolve(sourceDir, 'params.yml'))) {
        genericPath = path.resolve(sourceDir, 'params.yml');
    } else if (fs.existsSync(path.resolve(sourceDir, 'params.yaml'))) {
        genericPath = path.resolve(sourceDir, 'params.yaml');
    }

    const genData = genericPath? fs.readFileSync(genericPath).toString() : '';
    const genObj = genData? yaml.parse(genData) : {};

    let envPath = ''
    if (fs.existsSync(path.resolve(sourceDir, `params_${environment}.yml`))) {
        envPath = path.resolve(sourceDir, `params_${environment}.yml`);
    } else if (fs.existsSync(path.resolve(sourceDir, `params_${environment}.yaml`))) {
        envPath = path.resolve(sourceDir, `params_${environment}.yaml`);
    }

    let envRegionPath = '';
    if (fs.existsSync(path.resolve(sourceDir, `params_${environment}.${region}.yml`))) {
        envRegionPath = path.resolve(sourceDir, `params_${environment}.${region}.yml`);
    } else if (fs.existsSync(path.resolve(sourceDir, `params_${environment}.${region}.yaml`))) {
        envRegionPath = path.resolve(sourceDir, `params_${environment}.${region}.yaml`);
    }

    const envData = envPath? fs.readFileSync(envPath).toString() : '';
    const envObj = envData? yaml.parse(envData) :  {};
    let retval = _.mergeWith(genObj, envObj);

    const envRegionData = envRegionPath? fs.readFileSync(envRegionPath).toString() : '';
    const envRegionObj = envRegionData? yaml.parse(envRegionData) :  {};
    retval = _.mergeWith(retval, envRegionObj);

    return retval;
}

async function deleteParamTree(obj, pathRoot, samconfig) {
    const ssm = new aws.SSM({ region: samconfig.region });
    await Promise.all(Object.keys(obj).map(async key => {
        await ssm.deleteParameter({
            Name: `${pathRoot}${key}`
        });
        if(Object.keys(obj[key]).length != 0) {
            await deleteParamTree(obj[key], `${pathRoot}${key}/`, samconfig);
        }
    }));
}

async function writeToSSM(updates, ssmConfig, pathRoot, cleanUp, force, samconfig) {
    const ssm = new aws.SSM({ region: samconfig.region });
    for(let objKey of Object.keys(updates)) {
        const key = objKey == 'env'? samconfig.environment : objKey;

        logger.debug('Evaluating path', key);

        if(force || !_.isEqual(updates[objKey], ssmConfig? ssmConfig[key] : undefined)) {
            if(Array.isArray(updates[objKey]) || typeof updates[objKey] == 'string' || Object.keys(updates[objKey]).length == 0) {
                const isArray = Array.isArray(updates[objKey]);
                logger.debug('Writing value for ', key, updates[objKey], 'isArray', isArray);
                await ssm.putParameter({
                    Name: `${pathRoot}${key}`,
                    Value: isArray? updates[objKey].join(',') : updates[objKey].toString(),
                    Type: isArray? 'StringList' : 'String',
                    Overwrite: true
                });
                logger.debug('Value written', pathRoot, key);
            } else {
                logger.debug('Cascading key', key);
                const body = JSON.stringify(updates[objKey]);
                if(Buffer.from(body).byteLength < 4000) {
                    const params = {
                        Name: `${pathRoot}${key}`,
                        Value: JSON.stringify(updates[objKey]),
                        Type: 'String',
                        Overwrite: true
                    };
                    logger.debug('Writing rollup', params);
                    await ssm.putParameter(params);
                } else {
                    logger.warn('Object larger than 4 kb, skipping writing rollup');
                }
                await writeToSSM(updates[objKey], ssmConfig? ssmConfig[key] : undefined, `${pathRoot}${key}/`, cleanUp, force, samconfig);
            }
        } else {
            var i = 0;
        }
    }

    if(ssmConfig && cleanUp) {
        await Promise.all(Object.keys(ssmConfig).map(async key => {
            if(updates[key] == undefined && ssmConfig[key] != undefined) {
                await ssm.deleteParameter({
                    Name: `${pathRoot}${key}`
                });
                if(Object.keys(ssmConfig[key]).length != 0) {
                    await deleteParamTree(ssmConfig[key], `${pathRoot}${key}/`, samconfig);
                }
            }
        }));    
    }
}

async function mergeFilesWithEnv(samconfig) {
    logger.debug('Reading param config');
    const localConfig = readParamConfigs(samconfig.params_output || samconfig.params_dir, samconfig.environment, samconfig.region);
    logger.debug('Local values', localConfig);
    logger.debug('Getting ssm params');
    const ssmConfig = await ssmParamsToObj(samconfig);
    const ssmClone = _.cloneDeep(ssmConfig);
    const clean = samconfig.params_clean == 'true';
    const force = samconfig.force;
    console.log('Force', samconfig.force);
    const paramKeys = samconfig.params_keys? samconfig.params_keys.split(',') : undefined;
    if(paramKeys && clean) {
        logger.warn('Cleaning extra parameters');
        paramKeys.forEach(x => {
            const parts = x.slice(1).split('/');
            deleteKey(ssmClone, parts);
        });
    }

    if (paramKeys) {
        logger.info('Filtering data to specific keys', paramKeys);
        for(let key of paramKeys) {
            const writeParts = key.replace(/\/env\//g, `/${samconfig.environment}/`).slice(1).split('/').filter(x => x? true : false);
            const readParts = key.slice(1).split('/').filter(x => x? true : false);
            if(!_.isEqual(readParts, writeParts)) {
                const value = getKey(localConfig, readParts);
                logger.debug('Setting value', writeParts, value);
                setObjKey(localConfig, writeParts, value);
                logger.debug('Value set', localConfig);
                deleteKey(localConfig, readParts);    
            }
        }
        logger.info('Finished processing keys');
    }

    const results = _.mergeWith(ssmClone, _.cloneDeep(localConfig));

    await writeToSSM(results, ssmConfig, '/', clean, force, samconfig);
}

module.exports.ssmParamsToObj = ssmParamsToObj;
module.exports.paramsSetKey = setKey;
module.exports.ssmParamsToYaml = ssmParamsToYaml;
module.exports.readParamConfigs = readParamConfigs;
module.exports.mergeFilesWithEnv = mergeFilesWithEnv;
