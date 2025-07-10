/**
 * ThreadshiftConfig - Singleton configuration manager for Threadshift plugin
 * Handles all configuration, feature flags, and settings persistence
 */

class ThreadshiftConfig {
    static instance = null;
    
    static getInstance() {
        if (!ThreadshiftConfig.instance) {
            ThreadshiftConfig.instance = new ThreadshiftConfig();
        }
        return ThreadshiftConfig.instance;
    }
    
    constructor() {
        if (ThreadshiftConfig.instance) {
            return ThreadshiftConfig.instance;
        }
        
        this.initialized = false;
        this.storageKey = 'threadshift_config';
        this.version = '1.0.0';
        
        // Default configuration structure
        this.data = {
            version: this.version,
            features: {
                // Core features (always enabled)
                coreEngine: true,
                basicTransformations: true,
                inventorySystem: true,
                historyTracking: true,
                multiCharacter: true,
                
                // UI features (user configurable)
                chatCommands: true,
                uiPanel: true,
                visualizer: true,
                storyTriggers: true,
                
                // Advanced features (configurable)
                advancedEnabled: true,
                lazyLoading: true,
                backgroundProcessing: true,
                memoryOptimization: true,
                compressionEnabled: false,
                
                // Optional features (can be disabled)
                consentManager: false,
                traitModifier: false,
                lorebookIntegration: false,
                experimentalFeatures: false
            },
            
            ui: {
                theme: 'auto', // 'auto', 'light', 'dark'
                panelPosition: 'right', // 'left', 'right', 'bottom'
                commandPrefix: '/',
                showNotifications: true,
                animationSpeed: 'normal', // 'slow', 'normal', 'fast', 'disabled'
                compactMode: false,
                showTooltips: true
            },
            
            performance: {
                cacheSize: 100,
                maxHistoryEntries: 50,
                autoSave: true,
                autoSaveInterval: 30000, // 30 seconds
                lazyLoadThreshold: 20,
                backgroundTaskDelay: 100,
                memoryCleanupInterval: 300000, // 5 minutes
                maxCacheAge: 3600000 // 1 hour
            },
            
            storage: {
                keys: {
                    characters: 'threadshift_characters',
                    garments: 'threadshift_garments',
                    history: 'threadshift_history',
                    settings: 'threadshift_settings',
                    cache: 'threadshift_cache'
                },
                compression: false,
                backupEnabled: true,
                maxBackups: 5,
                encryptionEnabled: false
            },
            
            engine: {
                validateTransformations: true,
                allowPartialTransformations: true,
                strictZoneMatching: false,
                reciprocalTransformations: true,
                conflictResolution: 'merge', // 'merge', 'overwrite', 'skip'
                transformationLogging: true,
                maxTransformationDepth: 10
            },
            
            character: {
                autoDetectFormat: true,
                supportedFormats: ['SillyTavern_v2', 'CharacterAI', 'Pygmalion'],
                defaultZones: ['hair', 'face', 'neck', 'chest', 'waist', 'hips', 'genitals', 'hands', 'legs', 'feet'],
                requireCharacterPrefix: true,
                characterIdFormat: 'charXXXX'
            },
            
            garment: {
                autoGenerateIds: true,
                garmentIdFormat: 'XXXX.XXXX',
                trackOwnership: true,
                trackHistory: true,
                allowAnonymousGarments: false,
                maxGarmentsPerCharacter: 1000
            },
            
            debug: {
                enabled: false,
                logLevel: 'info', // 'error', 'warn', 'info', 'debug', 'trace'
                logToConsole: true,
                logToStorage: false,
                maxLogEntries: 1000,
                performanceLogging: false,
                verboseTransformations: false
            },
            
            compatibility: {
                sillyTavernVersion: '1.12.0',
                apiVersion: '1.0.0',
                legacySupport: false,
                strictMode: false
            }
        };
        
        // Runtime state
        this.errors = [];
        this.warnings = [];
        this.lastSaved = null;
        this.isDirty = false;
        
        ThreadshiftConfig.instance = this;
    }
    
    /**
     * Initialize configuration - load from storage and validate
     */
    async initialize() {
        if (this.initialized) {
            return true;
        }
        
        try {
            await this.loadFromStorage();
            this.validateConfiguration();
            this.initialized = true;
            console.log('✓ ThreadshiftConfig initialized');
            return true;
        } catch (error) {
            console.error('✗ ThreadshiftConfig initialization failed:', error);
            this.errors.push({
                type: 'initialization',
                message: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
    
    /**
     * Load configuration from SillyTavern extension storage
     */
    async loadFromStorage() {
        try {
            // Check if we have access to SillyTavern's extension storage
            if (typeof window.extensionSettings === 'undefined') {
                console.warn('⚠ SillyTavern extension storage not available, using defaults');
                return;
            }
            
            const storedConfig = window.extensionSettings[this.storageKey];
            
            if (storedConfig) {
                // Merge stored config with defaults (in case new options were added)
                this.data = this.deepMerge(this.data, storedConfig);
                
                // Handle version migrations if needed
                if (storedConfig.version !== this.version) {
                    await this.migrateConfiguration(storedConfig.version, this.version);
                }
                
                this.lastSaved = storedConfig._lastSaved || null;
                console.log('✓ Configuration loaded from storage');
            } else {
                console.log('ℹ No stored configuration found, using defaults');
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            throw error;
        }
    }
    
    /**
     * Save configuration to SillyTavern extension storage
     */
    async saveToStorage() {
        try {
            if (typeof window.extensionSettings === 'undefined') {
                console.warn('⚠ Cannot save configuration - extension storage not available');
                return false;
            }
            
            const configToSave = {
                ...this.data,
                _lastSaved: new Date().toISOString(),
                _version: this.version
            };
            
            window.extensionSettings[this.storageKey] = configToSave;
            
            // Trigger SillyTavern's save mechanism if available
            if (typeof window.saveSettings === 'function') {
                await window.saveSettings();
            }
            
            this.lastSaved = configToSave._lastSaved;
            this.isDirty = false;
            console.log('✓ Configuration saved to storage');
            return true;
        } catch (error) {
            console.error('Error saving configuration:', error);
            this.errors.push({
                type: 'storage',
                message: `Failed to save configuration: ${error.message}`,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
    
    /**
     * Get configuration value by path (dot notation)
     */
    get(path) {
        return this.getNestedValue(this.data, path);
    }
    
    /**
     * Set configuration value by path (dot notation)
     */
    set(path, value) {
        this.setNestedValue(this.data, path, value);
        this.isDirty = true;
        
        // Auto-save if enabled
        if (this.data.performance.autoSave) {
            setTimeout(() => this.saveToStorage(), 0);
        }
    }
    
    /**
     * Get nested value from object using dot notation
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }
    
    /**
     * Set nested value in object using dot notation
     */
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            return current[key] = current[key] || {};
        }, obj);
        target[lastKey] = value;
    }
    
    /**
     * Deep merge two objects
     */
    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }
    
    /**
     * Validate configuration structure and values
     */
    validateConfiguration() {
        const errors = [];
        
        // Validate required fields
        if (!this.data.version) {
            errors.push('Missing version field');
        }
        
        // Validate performance settings
        if (this.data.performance.cacheSize < 1) {
            errors.push('Cache size must be at least 1');
            this.data.performance.cacheSize = 100;
        }
        
        if (this.data.performance.maxHistoryEntries < 1) {
            errors.push('Max history entries must be at least 1');
            this.data.performance.maxHistoryEntries = 50;
        }
        
        // Validate UI settings
        if (!['auto', 'light', 'dark'].includes(this.data.ui.theme)) {
            errors.push('Invalid theme setting');
            this.data.ui.theme = 'auto';
        }
        
        if (!['left', 'right', 'bottom'].includes(this.data.ui.panelPosition)) {
            errors.push('Invalid panel position');
            this.data.ui.panelPosition = 'right';
        }
        
        // Validate engine settings
        if (!['merge', 'overwrite', 'skip'].includes(this.data.engine.conflictResolution)) {
            errors.push('Invalid conflict resolution mode');
            this.data.engine.conflictResolution = 'merge';
        }
        
        if (errors.length > 0) {
            this.warnings = this.warnings.concat(errors.map(error => ({
                type: 'validation',
                message: error,
                timestamp: new Date().toISOString()
            })));
        }
    }
    
    /**
     * Migrate configuration from old version to new version
     */
    async migrateConfiguration(oldVersion, newVersion) {
        console.log(`Migrating configuration from ${oldVersion} to ${newVersion}`);
        
        // Add migration logic here as needed
        // For now, just update the version
        this.data.version = newVersion;
        
        // Save after migration
        await this.saveToStorage();
    }
    
    /**
     * Reset configuration to defaults
     */
    reset() {
        this.data = new ThreadshiftConfig().data;
        this.isDirty = true;
        this.errors = [];
        this.warnings = [];
        console.log('Configuration reset to defaults');
    }
    
    /**
     * Get feature flag status
     */
    isFeatureEnabled(featureName) {
        return this.get(`features.${featureName}`) === true;
    }
    
    /**
     * Enable/disable feature
     */
    setFeature(featureName, enabled) {
        this.set(`features.${featureName}`, enabled);
    }
    
    /**
     * Get all errors
     */
    getErrors() {
        return [...this.errors];
    }
    
    /**
     * Get all warnings
     */
    getWarnings() {
        return [...this.warnings];
    }
    
    /**
     * Clear errors and warnings
     */
    clearErrors() {
        this.errors = [];
        this.warnings = [];
    }
    
    /**
     * Export configuration for backup
     */
    export() {
        return {
            ...this.data,
            _exported: new Date().toISOString(),
            _exportVersion: this.version
        };
    }
    
    /**
     * Import configuration from backup
     */
    async import(configData) {
        if (!configData || typeof configData !== 'object') {
            throw new Error('Invalid configuration data');
        }
        
        // Validate imported data
        if (configData._exportVersion && configData._exportVersion !== this.version) {
            console.warn(`Importing configuration from different version: ${configData._exportVersion}`);
        }
        
        // Merge with current configuration
        this.data = this.deepMerge(this.data, configData);
        this.validateConfiguration();
        this.isDirty = true;
        
        // Save imported configuration
        await this.saveToStorage();
        console.log('✓ Configuration imported successfully');
    }
    
    /**
     * Get configuration summary for diagnostics
     */
    getDiagnosticInfo() {
        return {
            version: this.version,
            initialized: this.initialized,
            lastSaved: this.lastSaved,
            isDirty: this.isDirty,
            errorCount: this.errors.length,
            warningCount: this.warnings.length,
            featuresEnabled: Object.keys(this.data.features).filter(key => this.data.features[key]).length,
            cacheSize: this.data.performance.cacheSize,
            storageKeys: Object.keys(this.data.storage.keys).length
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftConfig;
} else if (typeof window !== 'undefined') {
    window.ThreadshiftConfig = ThreadshiftConfig;
}