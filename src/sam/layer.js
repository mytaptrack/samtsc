console.log('samtsc: Loading SAM Framework Tools');
const { execSync } = require('child_process');
const { mkdir, existsSync, writeFileSync, readFileSync, watch } = require('../file-system');
const path = require('path');
const { logger } = require('../logger');
const { EventEmitter } = require('events');
const { SAMCompiledDirectory } = require('./compiled-directory');

class SAMLayerLib extends SAMCompiledDirectory {
    constructor(dirPath, samconfig, buildRoot, events) {
        super(dirPath, samconfig, buildRoot);
        this.isLibrary = true;
        const self = this;
        this.events.on('build-complete', () => { events.emit('layer-change');});
    }
}

class SAMLayer {
    constructor(name, properties, metadata, stackName, buildRoot, samconfig) {
        this.name = name;
        this.buildRoot = buildRoot;
        this.events = new EventEmitter();
        this.stackName = stackName;
        this.samconfig = samconfig;
        this.setConfig(properties, metadata);
        console.log(`samtsc: Identified Serverless Layer: ${this.path}`);

        const self = this;
        this.fileEvent(this.packagePath);
    }

    setConfig(properties, metadata) {
        this.path = properties.ContentUri;
        this.layerName = properties.LayerName || `${this.stackName}-${this.name}`;
        this.packageFolder = 'nodejs/';
        if(metadata && metadata.BuildMethod && metadata.BuildMethod.startsWith('nodejs')) {
            this.packageFolder = '';
        }
        this.packagePath = this.packageFolder + 'package.json';
    }

    fileEvent(filePath) {
        if(filePath != this.packagePath) {
            return;
        }

        const pckFolder = path.resolve(this.path, this.packageFolder);
        if(!existsSync(this.packagePath)) {
            console.log('samtsc: nodejs/package.json does not exist');
            return;
        }
        const pckFilePath = path.resolve(pckFolder, this.packagePath);
        this.pck = JSON.parse(readFileSync(pckFilePath).toString());
        if(!this.pck.dependencies) {
            this.pck.dependencies = {};
        }

        if(this.name == this.samconfig.stack_reference_layer) {
            console.log('samtsc: Constructing combined dependencies');
            const rootPck = JSON.parse(readFileSync('package.json'));

            const packs = !rootPck.dependencies? [] : Object.keys(rootPck.dependencies).forEach(k => {
                let val = rootPck.dependencies[k];
                if(!val.startsWith('file:')) {
                    this.pck.dependencies[k] = val;
                    return;
                }

                val = val.slice(5);
                let abPath = path.relative(pckFolder, path.resolve(val));
                this.pck.dependencies[k] = 'file:' + abPath;
            });

            console.log('samtsc: Construction complete');
        }

        const self = this;
        this.libs = Object.values(this.pck.dependencies).filter(d => {
            if(!d.startsWith('file:')) {
                return false;
            }
            const subpath = path.resolve(this.path, this.packageFolder, d.slice(5));
            return subpath.startsWith(process.cwd());
        }).map(d => {
            console.log(d.slice(5));
            const fullPath = path.resolve(this.path, this.packageFolder, d.slice(5));
            const subpath = path.relative(process.cwd(), fullPath);
            console.log(subpath);
            return new SAMLayerLib(subpath, this.samconfig, this.buildRoot, this.events);
        });

        this.libs.forEach(x => {
            x.buildIfNotPresent()
            x.events.on('build-complete', () => {
                this.events.emit('layer-change', this);
            });
        });

        console.log('samtsc: constructing build directory');
        const nodejsPath = `${this.buildRoot}/${this.path}/${this.packageFolder}`;
        mkdir(nodejsPath);

        const pckCopy = JSON.parse(JSON.stringify(this.pck));
        if(pckCopy.dependencies) {
            Object.keys(pckCopy.dependencies).forEach(k => {
                const val = pckCopy.dependencies[k];
                if(!val.startsWith('file:')) {
                    return;
                }

                let refPath = val.slice(5);
                const abPath = path.resolve(pckFolder, refPath);
                if(abPath.startsWith(process.cwd())) {
                    refPath = path.resolve(nodejsPath, refPath);
                } else {
                    refPath = abPath;
                }
                pckCopy.dependencies[k] = refPath;
            });
        }
        writeFileSync(nodejsPath + 'package.json', JSON.stringify(pckCopy, undefined, 2));

        console.log('samtsc: installing dependencies');
        execSync('npm i --only=prod', { cwd: nodejsPath, stdio: 'inherit' });
        
        console.log('samtsc: file change ', filePath);
        this.events.emit('layer-change', this);
    }

    cleanup() {
        this.libs && this.libs.forEach(x => x.cleanup());
    }
}

module.exports.SAMLayer = SAMLayer;
