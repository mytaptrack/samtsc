class Logger {
    constructor() {
        this.samconfig = {};
    }
    loadConfig(samconfig) {
        this.samconfig = samconfig;
    }
    debug(...params) {
        if(this.samconfig.debug) {
            console.log('samtsc: DEBUG', ...params);
        }
    }

    info(...params) {
        console.log('samtsc:', ...params);
    }

    warn(...params) {
        console.log('samtsc:', ...params);
    }

    error(...params) {
        console.log('samtsc:', ...params);
    }

    attention(...params) {
        console.log('samtsc:', ...params);
    }

    success(...params) {
        console.log('samtsc:', ...params);
    }
}

const logger = new Logger();
module.exports.logger = logger;
