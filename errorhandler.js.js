/**
 * ThreadshiftErrorHandler - Centralized error handling and logging for Threadshift
 * Part of the foundation layer - handles all errors, warnings, and diagnostic logging
 */

class ThreadshiftErrorHandler extends ThreadshiftModule {
    constructor() {
        super('ErrorHandler');
        
        // Error categories and severity levels
        this.errorCategories = {
            CRITICAL: 'critical',
            VALIDATION: 'validation',
            STORAGE: 'storage',
            ENGINE: 'engine',
            UI: 'ui',
            PERFORMANCE: 'performance',
            NETWORK: 'network',
            COMPATIBILITY: 'compatibility'
        };
        
        this.severityLevels = {
            TRACE: 0,
            DEBUG: 1,
            INFO: 2,
            WARN: 3,
            ERROR: 4,
            CRITICAL: 5
        };
        
        // Error storage
        this.errorLog = [];
        this.warningLog = [];
        this.performanceLog = [];
        this.debugLog = [];
        
        // Configuration
        this.maxLogEntries = 1000;
        this.logToConsole = true;
        this.logToStorage = false;
        this.currentLogLevel = this.severityLevels.INFO;
        
        // Error statistics
        this.errorStats = {
            totalErrors: 0,
            totalWarnings: 0,
            criticalErrors: 0,
            errorsByCategory: {},
            errorsByModule: {},
            sessionStartTime: new Date().toISOString()
        };
        
        // Recovery strategies
        this.recoveryStrategies = new Map();
        this.fallbackHandlers = new Map();
        
        // Error reporting
        this.errorReportQueue = [];
        this.reportingEnabled = false;
        
        // Global error handlers
        this.globalErrorHandlersSetup = false;
    }
    
    /**
     * Initialize error handler
     */
    async initialize() {
        await super.initialize();
        
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Setup global error handlers
            this.setupGlobalErrorHandlers();
            
            // Setup performance monitoring
            this.setupPerformanceMonitoring();
            
            // Initialize recovery strategies
            this.initializeRecoveryStrategies();
            
            // Setup auto-cleanup
            this.setupAutoCleanup();
            
            this.logInfo('ErrorHandler initialized successfully');
            return true;
            
        } catch (error) {
            console.error('CRITICAL: ErrorHandler initialization failed:', error);
            return false;
        }
    }
    
    /**
     * Load configuration from ThreadshiftConfig
     */
    async loadConfiguration() {
        if (this.config) {
            this.currentLogLevel = this.severityLevels[this.config.get('debug.logLevel')?.toUpperCase()] || this.severityLevels.INFO;
            this.logToConsole = this.config.get('debug.logToConsole') !== false;
            this.logToStorage = this.config.get('debug.logToStorage') === true;
            this.maxLogEntries = this.config.get('debug.maxLogEntries') || 1000;
            this.reportingEnabled = this.config.get('debug.errorReporting') === true;
        }
    }
    
    /**
     * Setup global error handlers for uncaught errors
     */
    setupGlobalErrorHandlers() {
        if (this.globalErrorHandlersSetup) return;
        
        // Handle uncaught JavaScript errors
        window.addEventListener('error', (event) => {
            this.handleGlobalError('javascript', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });
        
        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handleGlobalError('promise', {
                message: event.reason?.message || 'Unhandled promise rejection',
                reason: event.reason,
                promise: event.promise
            });
        });
        
        // Handle SillyTavern specific errors if available
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('st_error', (event) => {
                this.handleGlobalError('sillytavern', event.detail);
            });
        }
        
        this.globalErrorHandlersSetup = true;
    }
    
    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        if (!this.config?.get('debug.performanceLogging')) return;
        
        // Monitor long-running operations
        this.performanceObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.duration > 100) { // Log operations over 100ms
                    this.logPerformance({
                        name: entry.name,
                        duration: entry.duration,
                        startTime: entry.startTime,
                        type: entry.entryType
                    });
                }
            }
        });
        
        // Observe different types of performance entries
        try {
            this.performanceObserver.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
        } catch (error) {
            this.logWarning('Performance monitoring not available in this environment');
        }
    }
    
    /**
     * Initialize recovery strategies for common errors
     */
    initializeRecoveryStrategies() {
        // Storage recovery
        this.recoveryStrategies.set('storage_failure', async (error, context) => {
            this.logWarning('Storage failure detected, attempting recovery');
            try {
                // Try to reinitialize storage
                if (window.Threadshift?.foundation?.storage?.initialize) {
                    await window.Threadshift.foundation.storage.initialize();
                    return { success: true, message: 'Storage reinitialized' };
                }
                return { success: false, message: 'Storage module not available' };
            } catch (recoveryError) {
                return { success: false, message: recoveryError.message };
            }
        });
        
        // Character data recovery
        this.recoveryStrategies.set('character_corruption', async (error, context) => {
            this.logWarning('Character data corruption detected, attempting recovery');
            try {
                // Try to reload character from backup
                if (context.characterId && window.Threadshift?.foundation?.storage?.loadCharacterBackup) {
                    const backup = await window.Threadshift.foundation.storage.loadCharacterBackup(context.characterId);
                    if (backup) {
                        return { success: true, message: 'Character restored from backup', data: backup };
                    }
                }
                return { success: false, message: 'No backup available' };
            } catch (recoveryError) {
                return { success: false, message: recoveryError.message };
            }
        });
        
        // Engine recovery
        this.recoveryStrategies.set('engine_failure', async (error, context) => {
            this.logWarning('Engine failure detected, attempting recovery');
            try {
                // Reset engine state
                if (window.Threadshift?.engine?.swapEngine?.reset) {
                    await window.Threadshift.engine.swapEngine.reset();
                    return { success: true, message: 'Engine reset successfully' };
                }
                return { success: false, message: 'Engine module not available' };
            } catch (recoveryError) {
                return { success: false, message: recoveryError.message };
            }
        });
    }
    
    /**
     * Setup automatic cleanup of old logs
     */
    setupAutoCleanup() {
        // Clean up logs every 5 minutes
        setInterval(() => {
            this.cleanupOldLogs();
        }, 300000);
    }
    
    /**
     * Handle global errors (uncaught exceptions, etc.)
     */
    handleGlobalError(source, errorInfo) {
        const error = {
            id: this.generateErrorId(),
            source: source,
            category: this.errorCategories.CRITICAL,
            severity: this.severityLevels.CRITICAL,
            message: errorInfo.message,
            details: errorInfo,
            timestamp: new Date().toISOString(),
            module: 'global',
            context: 'global_handler'
        };
        
        this.recordError(error);
        
        // Try to recover if possible
        if (this.recoveryStrategies.has(source)) {
            this.attemptRecovery(source, error);
        }
    }
    
    /**
     * Main error handling method
     */
    handleError(module, context, error, options = {}) {
        const errorEntry = {
            id: this.generateErrorId(),
            module: module,
            context: context,
            category: options.category || this.errorCategories.ERROR,
            severity: options.severity || this.severityLevels.ERROR,
            message: error.message || String(error),
            stack: error.stack,
            details: options.details || {},
            timestamp: new Date().toISOString(),
            isCritical: options.critical === true,
            canRecover: options.canRecover !== false,
            userId: options.userId || 'unknown'
        };
        
        this.recordError(errorEntry);
        
        // Attempt recovery if enabled and possible
        if (errorEntry.canRecover && this.recoveryStrategies.has(errorEntry.category)) {
            this.attemptRecovery(errorEntry.category, errorEntry);
        }
        
        // Fire events for other modules
        this.fireEvent('error', errorEntry);
        
        // Handle critical errors
        if (errorEntry.isCritical) {
            this.handleCriticalError(errorEntry);
        }
        
        return errorEntry.id;
    }
    
    /**
     * Record error in logs and update statistics
     */
    recordError(errorEntry) {
        // Add to error log
        this.errorLog.push(errorEntry);
        
        // Update statistics
        this.errorStats.totalErrors++;
        if (errorEntry.severity === this.severityLevels.CRITICAL) {
            this.errorStats.criticalErrors++;
        }
        
        // Update category statistics
        if (!this.errorStats.errorsByCategory[errorEntry.category]) {
            this.errorStats.errorsByCategory[errorEntry.category] = 0;
        }
        this.errorStats.errorsByCategory[errorEntry.category]++;
        
        // Update module statistics
        if (!this.errorStats.errorsByModule[errorEntry.module]) {
            this.errorStats.errorsByModule[errorEntry.module] = 0;
        }
        this.errorStats.errorsByModule[errorEntry.module]++;
        
        // Log to console if enabled
        if (this.logToConsole && errorEntry.severity >= this.currentLogLevel) {
            this.logToConsoleWithSeverity(errorEntry);
        }
        
        // Log to storage if enabled
        if (this.logToStorage) {
            this.logToStorageAsync(errorEntry);
        }
        
        // Add to error report queue if reporting enabled
        if (this.reportingEnabled) {
            this.errorReportQueue.push(errorEntry);
        }
        
        // Cleanup old entries if needed
        if (this.errorLog.length > this.maxLogEntries) {
            this.errorLog.shift();
        }
    }
    
    /**
     * Handle critical errors that might require plugin shutdown
     */
    handleCriticalError(errorEntry) {
        this.logError(`CRITICAL ERROR in ${errorEntry.module}: ${errorEntry.message}`);
        
        // Fire critical error event
        this.fireEvent('critical_error', errorEntry);
        
        // Notify other modules
        if (window.Threadshift) {
            const event = new CustomEvent('threadshift_critical_error', {
                detail: errorEntry
            });
            window.dispatchEvent(event);
        }
        
        // Consider disabling the failing module
        if (errorEntry.module !== 'ErrorHandler') {
            this.suggestModuleDisable(errorEntry.module);
        }
    }
    
    /**
     * Suggest disabling a module that's causing critical errors
     */
    suggestModuleDisable(moduleName) {
        const recentErrors = this.errorLog
            .filter(e => e.module === moduleName && e.severity >= this.severityLevels.ERROR)
            .slice(-5);
        
        if (recentErrors.length >= 3) {
            this.logWarning(`Module ${moduleName} has ${recentErrors.length} recent errors, consider disabling`);
            this.fireEvent('module_disable_suggested', { module: moduleName, errors: recentErrors });
        }
    }
    
    /**
     * Attempt to recover from an error
     */
    async attemptRecovery(strategyKey, errorEntry) {
        if (!this.recoveryStrategies.has(strategyKey)) {
            return { success: false, message: 'No recovery strategy available' };
        }
        
        try {
            const strategy = this.recoveryStrategies.get(strategyKey);
            const result = await strategy(errorEntry, errorEntry.details);
            
            if (result.success) {
                this.logInfo(`Recovery successful for ${strategyKey}: ${result.message}`);
                this.fireEvent('recovery_success', { strategy: strategyKey, error: errorEntry, result });
            } else {
                this.logWarning(`Recovery failed for ${strategyKey}: ${result.message}`);
                this.fireEvent('recovery_failed', { strategy: strategyKey, error: errorEntry, result });
            }
            
            return result;
        } catch (recoveryError) {
            this.logError(`Recovery strategy ${strategyKey} threw error: ${recoveryError.message}`);
            return { success: false, message: recoveryError.message };
        }
    }
    
    /**
     * Log warning
     */
    logWarning(module, message, details = {}) {
        const warningEntry = {
            id: this.generateErrorId(),
            module: module,
            message: message,
            details: details,
            timestamp: new Date().toISOString(),
            severity: this.severityLevels.WARN
        };
        
        this.warningLog.push(warningEntry);
        this.errorStats.totalWarnings++;
        
        if (this.logToConsole && this.severityLevels.WARN >= this.currentLogLevel) {
            console.warn(`[Threadshift:${module}] WARNING: ${message}`, details);
        }
        
        if (this.warningLog.length > this.maxLogEntries) {
            this.warningLog.shift();
        }
        
        this.fireEvent('warning', warningEntry);
        return warningEntry.id;
    }
    
    /**
     * Log performance metrics
     */
    logPerformance(data) {
        const perfEntry = {
            id: this.generateErrorId(),
            ...data,
            timestamp: new Date().toISOString()
        };
        
        this.performanceLog.push(perfEntry);
        
        if (this.performanceLog.length > this.maxLogEntries) {
            this.performanceLog.shift();
        }
        
        if (this.logToConsole && this.config?.get('debug.performanceLogging')) {
            console.log(`[Threadshift:Performance] ${data.name}: ${data.duration.toFixed(2)}ms`);
        }
        
        this.fireEvent('performance', perfEntry);
    }
    
    /**
     * Log debug information
     */
    logDebug(module, message, details = {}) {
        if (this.severityLevels.DEBUG < this.currentLogLevel) return;
        
        const debugEntry = {
            id: this.generateErrorId(),
            module: module,
            message: message,
            details: details,
            timestamp: new Date().toISOString(),
            severity: this.severityLevels.DEBUG
        };
        
        this.debugLog.push(debugEntry);
        
        if (this.debugLog.length > this.maxLogEntries) {
            this.debugLog.shift();
        }
        
        if (this.logToConsole) {
            console.debug(`[Threadshift:${module}] DEBUG: ${message}`, details);
        }
    }
    
    /**
     * Log to console with appropriate severity
     */
    logToConsoleWithSeverity(errorEntry) {
        const prefix = `[Threadshift:${errorEntry.module}]`;
        
        switch (errorEntry.severity) {
            case this.severityLevels.CRITICAL:
                console.error(`${prefix} CRITICAL: ${errorEntry.message}`, errorEntry);
                break;
            case this.severityLevels.ERROR:
                console.error(`${prefix} ERROR: ${errorEntry.message}`, errorEntry);
                break;
            case this.severityLevels.WARN:
                console.warn(`${prefix} WARNING: ${errorEntry.message}`, errorEntry);
                break;
            case this.severityLevels.INFO:
                console.info(`${prefix} INFO: ${errorEntry.message}`, errorEntry);
                break;
            default:
                console.log(`${prefix} ${errorEntry.message}`, errorEntry);
        }
    }
    
    /**
     * Log to storage asynchronously
     */
    async logToStorageAsync(errorEntry) {
        try {
            if (window.Threadshift?.foundation?.storage?.appendToLog) {
                await window.Threadshift.foundation.storage.appendToLog('errors', errorEntry);
            }
        } catch (error) {
            // Avoid recursive error logging
            console.error('Failed to log error to storage:', error);
        }
    }
    
    /**
     * Generate unique error ID
     */
    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get error statistics
     */
    getErrorStats() {
        return {
            ...this.errorStats,
            currentLogLevel: Object.keys(this.severityLevels)[this.currentLogLevel],
            logCounts: {
                errors: this.errorLog.length,
                warnings: this.warningLog.length,
                performance: this.performanceLog.length,
                debug: this.debugLog.length
            }
        };
    }
    
    /**
     * Get recent errors
     */
    getRecentErrors(limit = 20, severity = null) {
        let errors = this.errorLog;
        
        if (severity !== null) {
            errors = errors.filter(e => e.severity >= severity);
        }
        
        return errors.slice(-limit).reverse();
    }
    
    /**
     * Get errors by module
     */
    getErrorsByModule(module, limit = 20) {
        return this.errorLog
            .filter(e => e.module === module)
            .slice(-limit)
            .reverse();
    }
    
    /**
     * Get errors by category
     */
    getErrorsByCategory(category, limit = 20) {
        return this.errorLog
            .filter(e => e.category === category)
            .slice(-limit)
            .reverse();
    }
    
    /**
     * Clear all logs
     */
    clearLogs() {
        this.errorLog = [];
        this.warningLog = [];
        this.performanceLog = [];
        this.debugLog = [];
        this.errorStats = {
            totalErrors: 0,
            totalWarnings: 0,
            criticalErrors: 0,
            errorsByCategory: {},
            errorsByModule: {},
            sessionStartTime: new Date().toISOString()
        };
        this.logInfo('All logs cleared');
    }
    
    /**
     * Clean up old log entries
     */
    cleanupOldLogs() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
        
        const cleanupLog = (log) => {
            return log.filter(entry => new Date(entry.timestamp) > cutoff);
        };
        
        const beforeCounts = {
            errors: this.errorLog.length,
            warnings: this.warningLog.length,
            performance: this.performanceLog.length,
            debug: this.debugLog.length
        };
        
        this.errorLog = cleanupLog(this.errorLog);
        this.warningLog = cleanupLog(this.warningLog);
        this.performanceLog = cleanupLog(this.performanceLog);
        this.debugLog = cleanupLog(this.debugLog);
        
        const afterCounts = {
            errors: this.errorLog.length,
            warnings: this.warningLog.length,
            performance: this.performanceLog.length,
            debug: this.debugLog.length
        };
        
        const cleaned = {
            errors: beforeCounts.errors - afterCounts.errors,
            warnings: beforeCounts.warnings - afterCounts.warnings,
            performance: beforeCounts.performance - afterCounts.performance,
            debug: beforeCounts.debug - afterCounts.debug
        };
        
        const totalCleaned = Object.values(cleaned).reduce((sum, count) => sum + count, 0);
        
        if (totalCleaned > 0) {
            this.logDebug('ErrorHandler', `Cleaned up ${totalCleaned} old log entries`, cleaned);
        }
    }
    
    /**
     * Export logs for debugging
     */
    exportLogs() {
        return {
            metadata: {
                exportTime: new Date().toISOString(),
                version: this.config?.get('version') || 'unknown',
                sessionStart: this.errorStats.sessionStartTime
            },
            statistics: this.getErrorStats(),
            logs: {
                errors: this.errorLog,
                warnings: this.warningLog,
                performance: this.performanceLog,
                debug: this.debugLog
            }
        };
    }
    
    /**
     * Shutdown error handler
     */
    async shutdown() {
        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
        }
        
        // Clear all logs
        this.clearLogs();
        
        await super.shutdown();
    }
    
    /**
     * Get diagnostic information
     */
    getDiagnostics() {
        return {
            ...super.getDiagnostics(),
            errorStats: this.getErrorStats(),
            logSizes: {
                errors: this.errorLog.length,
                warnings: this.warningLog.length,
                performance: this.performanceLog.length,
                debug: this.debugLog.length
            },
            recoveryStrategies: Array.from(this.recoveryStrategies.keys()),
            globalHandlersSetup: this.globalErrorHandlersSetup
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftErrorHandler;
} else if (typeof window !== 'undefined') {
    window.ThreadshiftErrorHandler = ThreadshiftErrorHandler;
}