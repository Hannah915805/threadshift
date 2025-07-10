/**
 * ThreadshiftModule - Base class for all Threadshift plugin modules
 * Provides common functionality, error handling, and lifecycle management
 */

class ThreadshiftModule {
    constructor(moduleName = 'Unknown') {
        this.moduleName = moduleName;
        this.initialized = false;
        this.enabled = true;
        this.dependencies = [];
        this.dependents = [];
        this.config = null;
        this.errors = [];
        this.warnings = [];
        this.performance = {
            initTime: 0,
            lastOperation: null,
            operationCount: 0
        };
        this.eventListeners = new Map();
        this.cleanupTasks = [];
        this.startTime = null;
    }
    
    /**
     * Initialize the module - override in subclasses
     */
    async initialize() {
        if (this.initialized) {
            this.logWarning('Module already initialized');
            return true;
        }
        
        this.startTime = performance.now();
        this.logInfo('Initializing module...');
        
        try {
            // Get configuration instance
            this.config = ThreadshiftConfig.getInstance();
            if (!this.config.initialized) {
                throw new Error('Configuration not initialized');
            }
            
            // Validate dependencies
            await this.validateDependencies();
            
            // Setup error handling
            this.setupErrorHandling();
            
            // Module is ready
            this.initialized = true;
            this.performance.initTime = performance.now() - this.startTime;
            
            this.logInfo(`Module initialized successfully (${this.performance.initTime.toFixed(2)}ms)`);
            
            // Fire initialization event
            this.fireEvent('initialized', { module: this.moduleName });
            
            return true;
        } catch (error) {
            this.handleError('initialization', error);
            return false;
        }
    }
    
    /**
     * Shutdown the module - override in subclasses for cleanup
     */
    async shutdown() {
        if (!this.initialized) {
            this.logWarning('Module not initialized, cannot shutdown');
            return;
        }
        
        this.logInfo('Shutting down module...');
        
        try {
            // Run cleanup tasks
            await this.runCleanupTasks();
            
            // Remove event listeners
            this.removeAllEventListeners();
            
            // Clear state
            this.initialized = false;
            this.enabled = false;
            
            this.logInfo('Module shutdown complete');
            
            // Fire shutdown event
            this.fireEvent('shutdown', { module: this.moduleName });
            
        } catch (error) {
            this.handleError('shutdown', error);
        }
    }
    
    /**
     * Enable the module
     */
    enable() {
        if (!this.initialized) {
            this.logWarning('Cannot enable uninitialized module');
            return false;
        }
        
        this.enabled = true;
        this.logInfo('Module enabled');
        this.fireEvent('enabled', { module: this.moduleName });
        return true;
    }
    
    /**
     * Disable the module
     */
    disable() {
        this.enabled = false;
        this.logInfo('Module disabled');
        this.fireEvent('disabled', { module: this.moduleName });
    }
    
    /**
     * Check if module is ready for operation
     */
    isReady() {
        return this.initialized && this.enabled;
    }
    
    /**
     * Validate that all dependencies are available
     */
    async validateDependencies() {
        const missing = [];
        
        for (const dep of this.dependencies) {
            if (!this.isDependencyAvailable(dep)) {
                missing.push(dep);
            }
        }
        
        if (missing.length > 0) {
            throw new Error(`Missing dependencies: ${missing.join(', ')}`);
        }
        
        this.logInfo(`All dependencies validated: ${this.dependencies.join(', ')}`);
    }
    
    /**
     * Check if a dependency is available
     */
    isDependencyAvailable(dependency) {
        // Check for global objects
        if (dependency === 'config' && this.config) return true;
        if (dependency === 'storage' && typeof window.extensionSettings !== 'undefined') return true;
        if (dependency === 'characters' && typeof window.characters !== 'undefined') return true;
        if (dependency === 'chat' && typeof window.chat !== 'undefined') return true;
        
        // Check for Threadshift modules
        if (window.Threadshift && window.Threadshift[dependency]) return true;
        
        // Check for browser APIs
        if (dependency === 'localStorage' && typeof localStorage !== 'undefined') return true;
        if (dependency === 'indexedDB' && typeof indexedDB !== 'undefined') return true;
        
        return false;
    }
    
    /**
     * Add a dependency
     */
    addDependency(dependency) {
        if (!this.dependencies.includes(dependency)) {
            this.dependencies.push(dependency);
            this.logInfo(`Added dependency: ${dependency}`);
        }
    }
    
    /**
     * Remove a dependency
     */
    removeDependency(dependency) {
        const index = this.dependencies.indexOf(dependency);
        if (index > -1) {
            this.dependencies.splice(index, 1);
            this.logInfo(`Removed dependency: ${dependency}`);
        }
    }
    
    /**
     * Register a dependent module
     */
    registerDependent(moduleName) {
        if (!this.dependents.includes(moduleName)) {
            this.dependents.push(moduleName);
            this.logInfo(`Registered dependent: ${moduleName}`);
        }
    }
    
    /**
     * Setup error handling
     */
    setupErrorHandling() {
        // Global error handler for unhandled promise rejections
        if (typeof window !== 'undefined') {
            window.addEventListener('unhandledrejection', (event) => {
                this.handleError('unhandled_promise', event.reason);
            });
        }
        
        // Set up performance monitoring if enabled
        if (this.config.get('debug.performanceLogging')) {
            this.setupPerformanceMonitoring();
        }
    }
    
    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        const originalMethods = [];
        
        // Wrap async methods for performance tracking
        const methodsToTrack = ['initialize', 'shutdown', 'process', 'update', 'save', 'load'];
        
        methodsToTrack.forEach(methodName => {
            const original = this[methodName];
            if (typeof original === 'function') {
                this[methodName] = async (...args) => {
                    const start = performance.now();
                    try {
                        const result = await original.apply(this, args);
                        this.recordPerformance(methodName, performance.now() - start);
                        return result;
                    } catch (error) {
                        this.recordPerformance(methodName, performance.now() - start, error);
                        throw error;
                    }
                };
            }
        });
    }
    
    /**
     * Record performance metrics
     */
    recordPerformance(operation, duration, error = null) {
        this.performance.lastOperation = {
            name: operation,
            duration: duration,
            timestamp: new Date().toISOString(),
            error: error ? error.message : null
        };
        this.performance.operationCount++;
        
        if (this.config.get('debug.performanceLogging')) {
            const status = error ? 'ERROR' : 'OK';
            this.logInfo(`Performance [${operation}]: ${duration.toFixed(2)}ms - ${status}`);
        }
    }
    
    /**
     * Handle errors with proper logging and recovery
     */
    handleError(context, error, isCritical = false) {
        const errorInfo = {
            context: context,
            message: error.message || error,
            stack: error.stack,
            module: this.moduleName,
            timestamp: new Date().toISOString(),
            critical: isCritical
        };
        
        this.errors.push(errorInfo);
        
        // Log error
        if (isCritical) {
            this.logError(`CRITICAL ERROR in ${context}: ${error.message || error}`);
        } else {
            this.logError(`Error in ${context}: ${error.message || error}`);
        }
        
        // Fire error event
        this.fireEvent('error', errorInfo);
        
        // Handle critical errors
        if (isCritical) {
            this.disable();
            this.fireEvent('critical_error', errorInfo);
        }
    }
    
    /**
     * Add a cleanup task to run on shutdown
     */
    addCleanupTask(task) {
        if (typeof task === 'function') {
            this.cleanupTasks.push(task);
        }
    }
    
    /**
     * Run all cleanup tasks
     */
    async runCleanupTasks() {
        for (const task of this.cleanupTasks) {
            try {
                await task();
            } catch (error) {
                this.handleError('cleanup', error);
            }
        }
        this.cleanupTasks = [];
    }
    
    /**
     * Add event listener
     */
    addEventListener(event, handler) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(handler);
    }
    
    /**
     * Remove event listener
     */
    removeEventListener(event, handler) {
        if (this.eventListeners.has(event)) {
            const handlers = this.eventListeners.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    /**
     * Remove all event listeners
     */
    removeAllEventListeners() {
        this.eventListeners.clear();
    }
    
    /**
     * Fire an event
     */
    fireEvent(event, data = {}) {
        if (this.eventListeners.has(event)) {
            const handlers = this.eventListeners.get(event);
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.handleError(`event_handler_${event}`, error);
                }
            });
        }
        
        // Also fire global Threadshift event if available
        if (typeof window !== 'undefined' && window.Threadshift) {
            const customEvent = new CustomEvent(`threadshift_${event}`, {
                detail: { module: this.moduleName, ...data }
            });
            window.dispatchEvent(customEvent);
        }
    }
    
    /**
     * Logging methods
     */
    logInfo(message) {
        if (this.config && this.config.get('debug.logLevel') !== 'error') {
            console.log(`[Threadshift:${this.moduleName}] ${message}`);
        }
    }
    
    logWarning(message) {
        if (this.config && this.config.get('debug.logLevel') !== 'error') {
            console.warn(`[Threadshift:${this.moduleName}] WARNING: ${message}`);
        }
        this.warnings.push({
            message: message,
            timestamp: new Date().toISOString()
        });
    }
    
    logError(message) {
        console.error(`[Threadshift:${this.moduleName}] ERROR: ${message}`);
    }
    
    logDebug(message) {
        if (this.config && this.config.get('debug.logLevel') === 'debug') {
            console.debug(`[Threadshift:${this.moduleName}] DEBUG: ${message}`);
        }
    }
    
    /**
     * Utility method to check if feature is enabled
     */
    isFeatureEnabled(featureName) {
        return this.config && this.config.isFeatureEnabled(featureName);
    }
    
    /**
     * Utility method to get configuration value
     */
    getConfig(path, defaultValue = null) {
        return this.config ? this.config.get(path) || defaultValue : defaultValue;
    }
    
    /**
     * Utility method to set configuration value
     */
    setConfig(path, value) {
        if (this.config) {
            this.config.set(path, value);
        }
    }
    
    /**
     * Get module diagnostics
     */
    getDiagnostics() {
        return {
            moduleName: this.moduleName,
            initialized: this.initialized,
            enabled: this.enabled,
            dependencies: this.dependencies,
            dependents: this.dependents,
            errorCount: this.errors.length,
            warningCount: this.warnings.length,
            performance: {
                initTime: this.performance.initTime,
                operationCount: this.performance.operationCount,
                lastOperation: this.performance.lastOperation
            },
            eventListeners: Array.from(this.eventListeners.keys()),
            cleanupTasks: this.cleanupTasks.length
        };
    }
    
    /**
     * Get recent errors
     */
    getErrors(limit = 10) {
        return this.errors.slice(-limit);
    }
    
    /**
     * Get recent warnings
     */
    getWarnings(limit = 10) {
        return this.warnings.slice(-limit);
    }
    
    /**
     * Clear errors and warnings
     */
    clearLogs() {
        this.errors = [];
        this.warnings = [];
    }
    
    /**
     * Safe async operation wrapper
     */
    async safeOperation(operationName, operation, fallback = null) {
        if (!this.isReady()) {
            this.logWarning(`Cannot perform ${operationName}: module not ready`);
            return fallback;
        }
        
        try {
            const result = await operation();
            return result;
        } catch (error) {
            this.handleError(operationName, error);
            return fallback;
        }
    }
    
    /**
     * Throttle method calls
     */
    throttle(fn, delay) {
        let timeoutId;
        let lastExecTime = 0;
        
        return (...args) => {
            const currentTime = Date.now();
            
            if (currentTime - lastExecTime > delay) {
                fn.apply(this, args);
                lastExecTime = currentTime;
            } else {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    fn.apply(this, args);
                    lastExecTime = Date.now();
                }, delay - (currentTime - lastExecTime));
            }
        };
    }
    
    /**
     * Debounce method calls
     */
    debounce(fn, delay) {
        let timeoutId;
        
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftModule;
} else if (typeof window !== 'undefined') {
    window.ThreadshiftModule = ThreadshiftModule;
}