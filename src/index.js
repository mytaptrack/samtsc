#!/usr/bin/env node
console.log('Starting samtsc');
try {
    const fs = require('./file-system');
    const { exit, stdin } = require('process');
    const { SAMFramework } = require('./sam-template');

    console.log('Checking template file');
    let templateFile;
    if(fs.existsSync('template.yml')) {
        templateFile = 'template.yml';
    } else if(fs.existsSync('template.yaml')) {
        templateFile = 'template.yaml';
    }

    if(!templateFile) {
        console.error('Error: could not find SAM template');
        exit(1);
        return;
    }

    console.log('Checking Build Directories');
    const buildDir = './.build/root';
    if(!fs.existsSync(buildDir)) {
        fs.mkdir(buildDir);
    }

    const flags = {};
    let flag = '';
    for(let arg of process.argv) {
        if(arg.startsWith('--')) {
            flag = arg.slice(2).replace(/\-/g, '_');
            flags[flag] = 'true';
        } else if (flag) {
            flags[flag] = arg;
        }
    }

    const framework = new SAMFramework(templateFile, buildDir, flags)

    framework.load()
    .then(() => {
        if(flags.deploy_only != 'true' && flags.build_only != 'true') {
            console.log('samtsc: setup complete, waiting for modifications');
        } else {
            process.exit(0);
        }
    })
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
} catch (err) {
    console.log(err);
}