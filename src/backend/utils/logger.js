// Dead simple universal logger for backend usage
class Logger {
    static log(file, functionName, data = null, error = null) {
        const timestamp = new Date().toLocaleTimeString();
        let message = `[${timestamp}][${file}][${functionName}]`;
        if (data !== null && data !== undefined) {
            try {
                const payload = typeof data === 'object' ? JSON.stringify(data) : data;
                message += ` DATA: ${payload}`;
            } catch (_) {
                message += ' DATA: [unserializable]';
            }
        }
        if (error) {
            message += ` ERROR: ${error.message || error}`;
            console.error(message);
            if (error.stack) console.error('STACK:', error.stack);
        } else {
            console.log(message);
        }
    }
    static info(file, functionName, data = null) { this.log(file, functionName, data); }
    static error(file, functionName, error, data = null) { this.log(file, functionName, data, error); }
    static warn(file, functionName, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        let logMessage = `[${timestamp}][${file}][${functionName}] WARNING: ${message}`;
        if (data !== null && data !== undefined) {
            try {
                const payload = typeof data === 'object' ? JSON.stringify(data) : data;
                logMessage += ` DATA: ${payload}`;
            } catch (_) {
                logMessage += ' DATA: [unserializable]';
            }
        }
        console.warn(logMessage);
    }
}

export { Logger };


