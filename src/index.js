#!/usr/bin/env node
console.log('Starting samtsc');
try {

    const { exec, execSync } = require('child_process');
    const fs = require('fs');
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

    //
    // Identify if we already have access to bash
    //
    try {
        execSync('bash --version');
    } catch(err) {
        if(fs.existsSync('c:\\Windows\\System\\bash.exe')) {
            process.env.PATH = 'c:\\Windows\\System;' + process.env.PATH
        } else if(fs.existsSync('c:\\Program Files\\Git\\bin\\bash.exe')) {
            process.env.PATH = 'c:\\Program Files\\Git\\bin\\bash.exe' + process.env.PATH
        }
        console.error('Error: cannot invoke bash');
        exit(1);
        return;
    }

    console.log('Checking Build Directories');
    const buildDir = './.build/root';
    if(!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir);
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
        if(flags.deploy_only != 'true') {
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