const aws = require('aws-sdk');
const yaml = require('yaml');
const fs = require('../file-system');
const path = require('path');
const _ = require('lodash');

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

async function ssmParamsToObj() {
    const ssm = new aws.SSM();
    const awsResults = await ssm.getParameters().promise();
    awsResults.Parameters.sort((a, b) => a.Name.localeCompare(b.Name));

    const retval = {};
    awsResults.Parameters.forEach(x => {
        if(!x.Name) {
            return;
        }
        const parts = x.Name.slice(1).split('/');
        setKey(retval, parts, x.Value);
    });

    return retval;
}

async function ssmParamsToYaml(samconfig, skipWrite) {
    const paramKeys = samconfig.params_keys? samconfig.params_keys.split(',') : undefined;
    let retval = await ssmParamsToObj();
    if (paramKeys) {
        const old = retval;
        retval = {};
        paramKeys.forEach(x => {
            const parts = x.slice(1).split('/');
            setObjKey(retval, parts, getKey(old, parts));
        });
    }

    const data = yaml.stringify(retval);

    if(!skipWrite) {
        fs.writeFileSync(samconfig.params_output, data);
    }

    return data;
}

function readParamConfigs(sourceDir, environment) {
    let genericPath = '';
    if (fs.existsSync(path.resolve(sourceDir, 'params.yml'))) {
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

    const envData = envPath? fs.readFileSync(envPath).toString() : '';
    const envObj = envData? yaml.parse(envData) :  {};
    const retval = _.mergeWith(genObj, envObj);
    return retval;
}

async function deleteParamTree(obj, pathRoot) {
    const ssm = new aws.SSM();
    await Promise.all(Object.keys(obj).map(async key => {
        await ssm.deleteParameter({
            Name: `${pathRoot}${key}`
        }).promise();
        if(Object.keys(obj[key]).length != 0) {
            await deleteParamTree(obj[key], `${pathRoot}${key}/`);
        }
    }));
}

async function writeToSSM(updates, ssmConfig, pathRoot, cleanUp) {
    const ssm = new aws.SSM();
    await Promise.all(Object.keys(updates).map(async key => {
        if(!_.isEqual(updates[key], ssmConfig? ssmConfig[key] : undefined)) {
            if(Array.isArray(updates[key]) || typeof updates[key] == 'string' || Object.keys(updates[key]).length == 0) {
                await ssm.putParameter({
                    Name: `${pathRoot}${key}`,
                    Value: updates[key]
                }).promise();
            } else {
                const body = JSON.stringify(updates[key]);
                if(Buffer.from(body).byteLength < 4000) {
                    await ssm.putParameter({
                        Name: `${pathRoot}${key}`,
                        Value: JSON.stringify(updates[key])
                    }).promise();
                }
                await writeToSSM(updates[key], ssmConfig? ssmConfig[key] : undefined, `${pathRoot}${key}/`);
            }
        }
    }));

    if(ssmConfig && cleanUp) {
        await Promise.all(Object.keys(ssmConfig).map(async key => {
            if(updates[key] == undefined && ssmConfig[key] != undefined) {
                await ssm.deleteParameter({
                    Name: `${pathRoot}${key}`
                }).promise();
                if(Object.keys(ssmConfig[key]).length != 0) {
                    await deleteParamTree(ssmConfig[key], `${pathRoot}${key}/`);
                }
            }
        }));    
    }
}

async function mergeFilesWithEnv(samconfig) {
    const localConfig = readParamConfigs(samconfig.params_dir, samconfig.environment);
    const ssmConfig = await ssmParamsToObj();
    const ssmClone = _.cloneDeep(ssmConfig);
    const clean = samconfig.params_clean == 'true'
    const paramKeys = samconfig.params_keys? samconfig.params_keys.split(',') : undefined;
    if(paramKeys && clean) {
        paramKeys.forEach(x => {
            const parts = x.slice(1).split('/');
            deleteKey(ssmClone, parts);
        });
    }
    const results = _.mergeWith(ssmClone, _.cloneDeep(localConfig));

    await writeToSSM(results, ssmConfig, '/', clean);
}

module.exports.ssmParamsToObj = ssmParamsToObj;
module.exports.paramsSetKey = setKey;
module.exports.ssmParamsToYaml = ssmParamsToYaml;
module.exports.readParamConfigs = readParamConfigs;
module.exports.mergeFilesWithEnv = mergeFilesWithEnv;
