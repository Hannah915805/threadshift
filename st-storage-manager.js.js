// core/st-foundation/storage-manager.js
// Threadshift Foundation - Storage Manager
// Handles persistent storage of character body maps using SillyTavern's extensionSettings API

/**
 * Helper: Check if extensionSettings is a valid object for storage
 * @returns {boolean}
 */
function isValidSettings() {
    return typeof window.extensionSettings === 'object' &&
           window.extensionSettings !== null &&
           !Array.isArray(window.extensionSettings);
}

/**
 * Storage Manager for Threadshift body maps
 * Uses SillyTavern's extensionSettings for persistent storage
 * Namespaces all keys with 'threadshift_' prefix
 */
class ThreadshiftStorageManager extends ThreadshiftModule {
    constructor() {
        super('StorageManager');
        this.dependencies = ['config'];
        
        // Storage configuration from config
        this.storageKeys = {
            characters: 'threadshift_characters',
            garments: 'threadshift_garments',
            history: 'threadshift_history',
            session: 'threadshift_session',
            settings: 'threadshift_settings',
            cache: 'threadshift_cache'
        };
        
        this.storageVersions = {
            characters: '1.0.0',
            garments: '1.0.0',
            history: '1.0.0',
            session: '1.0.0',
            settings: '1.0.0',
            cache: '1.0.0'
        };
        
        this.fallbackStorage = new Map();
        this.storageValid = false;
        this.writeQueue = [];
        this.isProcessingQueue = false;
        
        // Performance tracking
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.writeOperations = 0;
        this.readOperations = 0;
    }

    async initialize() {
        if (!await super.initialize()) {
            return false;
        }
        
        // Initialize storage keys from config
        this.updateStorageKeysFromConfig();
        
        // Validate storage environment
        const storageValid = await this.initializeSafe('storage-validation', 
            () => this.validateStorageEnvironment(), true);
        
        if (!storageValid) {
            this.handleError('initialization', new Error('Storage validation failed'), true);
            return false;
        }

        // Optional initialization steps
        await this.initializeSafe('storage-migration', 
            () => this.migrateStorageIfNeeded(), false);
        
        await this.initializeSafe('storage-cleanup', 
            () => this.cleanupOrphanedData(), false);

        // Setup event listeners and monitoring
        this.setupStorageEventListeners();
        this.startPerformanceMonitoring();
        
        // Add cleanup task
        this.addCleanupTask(() => this.shutdown());
        
        this.logInfo('Storage manager initialized successfully');
        return true;
    }

    async shutdown() {
        await this.processWriteQueue();
        await this.saveAllPendingData();
        this.fallbackStorage.clear();
        this.writeQueue = [];
        await super.shutdown();
    }

    /**
     * Update storage keys from configuration
     */
    updateStorageKeysFromConfig() {
        if (this.config && this.config.get('storage.keys')) {
            const configKeys = this.config.get('storage.keys');
            this.storageKeys = { ...this.storageKeys, ...configKeys };
        }
    }

    /**
     * Validate that ST extension storage is available
     */
    async validateStorageEnvironment() {
        this.storageValid = isValidSettings();
        
        if (!this.storageValid) {
            this.logWarning('ST extensionSettings not available, using fallback storage');
            this.provideFallbackForLayer('storage-environment');
        } else {
            this.logInfo('ST extensionSettings validated successfully');
        }
        
        return true;
    }

    /**
     * Migrate storage from older versions if needed
     */
    async migrateStorageIfNeeded() {
        if (!this.storageValid) return;
        
        try {
            // Check for legacy storage format
            const legacyKeys = Object.keys(window.extensionSettings || {})
                .filter(key => key.startsWith('threadshift_bodyMap_'));
            
            if (legacyKeys.length > 0) {
                this.logInfo(`Found ${legacyKeys.length} legacy storage entries, migrating...`);
                await this.migrateLegacyStorage(legacyKeys);
            }
            
            // Check for version mismatches
            await this.validateStorageVersions();
            
        } catch (error) {
            this.handleError('migration', error, false);
        }
    }

    /**
     * Validate storage versions and migrate if needed
     */
    async validateStorageVersions() {
        for (const [key, expectedVersion] of Object.entries(this.storageVersions)) {
            const storageKey = this.storageKeys[key];
            const data = await this.loadFromStorage(key, null);
            
            if (data && data._version && data._version !== expectedVersion) {
                this.logInfo(`Migrating ${key} from version ${data._version} to ${expectedVersion}`);
                await this.migrateDataVersion(key, data._version, expectedVersion);
            }
        }
    }

    /**
     * Migrate data from one version to another
     */
    async migrateDataVersion(dataType, fromVersion, toVersion) {
        // Add specific migration logic here as needed
        this.logInfo(`Migration from ${fromVersion} to ${toVersion} for ${dataType} completed`);
    }

    /**
     * Migrate legacy storage format
     */
    async migrateLegacyStorage(legacyKeys) {
        const characters = {};
        let migratedCount = 0;
        
        for (const key of legacyKeys) {
            try {
                const characterId = key.replace('threadshift_bodyMap_', '');
                const bodyMap = window.extensionSettings[key];
                
                if (bodyMap && typeof bodyMap === 'object') {
                    characters[characterId] = {
                        id: characterId,
                        bodyMap: bodyMap,
                        _migrated: true,
                        _migratedAt: new Date().toISOString(),
                        _legacyKey: key
                    };
                    
                    migratedCount++;
                    
                    // Remove legacy key
                    delete window.extensionSettings[key];
                }
            } catch (error) {
                this.handleError('legacy-migration', error, false);
            }
        }
        
        if (migratedCount > 0) {
            await this.saveToStorage('characters', characters);
            this.logInfo(`Successfully migrated ${migratedCount} character body maps`);
            
            // Save settings to persist the cleanup
            if (typeof window.saveSettings === 'function') {
                await window.saveSettings();
            }
        }
    }

    /**
     * Clean up orphaned data
     */
    async cleanupOrphanedData() {
        if (!this.storageValid) return;
        
        try {
            const maxAge = this.getConfig('performance.maxCacheAge', 3600000); // 1 hour default
            const cutoffDate = new Date(Date.now() - maxAge);
            
            // Clean up old history entries
            const history = await this.loadFromStorage('history', []);
            const originalLength = history.length;
            
            const cleanedHistory = history.filter(entry => {
                const entryDate = new Date(entry.timestamp || entry._lastModified || 0);
                return entryDate > cutoffDate;
            });
            
            if (cleanedHistory.length !== originalLength) {
                await this.saveToStorage('history', cleanedHistory);
                this.logInfo(`Cleaned up ${originalLength - cleanedHistory.length} old history entries`);
            }
            
            // Clean up old cache entries
            await this.cleanupCache();
            
        } catch (error) {
            this.handleError('cleanup', error, false);
        }
    }

    /**
     * Clean up cache entries
     */
    async cleanupCache() {
        const cache = await this.loadFromStorage('cache', {});
        const maxAge = this.getConfig('performance.maxCacheAge', 3600000);
        const cutoffDate = new Date(Date.now() - maxAge);
        
        const cleanedCache = {};
        let removedCount = 0;
        
        for (const [key, entry] of Object.entries(cache)) {
            const entryDate = new Date(entry._cached || 0);
            if (entryDate > cutoffDate) {
                cleanedCache[key] = entry;
            } else {
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            await this.saveToStorage('cache', cleanedCache);
            this.logInfo(`Cleaned up ${removedCount} expired cache entries`);
        }
    }

    /**
     * Setup storage event listeners
     */
    setupStorageEventListeners() {
        // Listen for ST settings changes
        if (typeof window.eventSource !== 'undefined') {
            window.eventSource.on('extensionSettingsChanged', (data) => {
                if (data.key && data.key.startsWith('threadshift_')) {
                    this.handleStorageChange(data.key, data.value);
                }
            });
        }
        
        // Listen for configuration changes
        this.addEventListener('config-changed', (data) => {
            if (data.path && data.path.startsWith('storage.')) {
                this.updateStorageKeysFromConfig();
            }
        });
    }

    /**
     * Start performance monitoring
     */
    startPerformanceMonitoring() {
        if (!this.isFeatureEnabled('debug.performanceLogging')) return;
        
        setInterval(() => {
            this.logDebug(`Storage Performance: Reads=${this.readOperations}, Writes=${this.writeOperations}, Cache Hit Rate=${this.getCacheHitRate()}%`);
        }, 60000); // Every minute
    }

    /**
     * Get cache hit rate percentage
     */
    getCacheHitRate() {
        const total = this.cacheHits + this.cacheMisses;
        return total > 0 ? Math.round((this.cacheHits / total) * 100) : 0;
    }

    /**
     * Handle storage changes from external sources
     */
    handleStorageChange(key, value) {
        this.logDebug(`Storage change detected: ${key}`);
        this.fireEvent('storage-changed', { key, value });
    }

    /**
     * Get storage type from key
     */
    getStorageType(key) {
        const reverseMap = {};
        for (const [type, storageKey] of Object.entries(this.storageKeys)) {
            reverseMap[storageKey] = type;
        }
        return reverseMap[key] || 'unknown';
    }

    /**
     * Generate checksum for data integrity
     */
    generateChecksum(data) {
        // Remove metadata fields that shouldn't affect checksum
        const { _version, _lastSaved, _checksum, _cached, ...cleanData } = data;
        const str = JSON.stringify(cleanData);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return hash.toString(16);
    }

    /**
     * Queue write operation to prevent conflicts
     */
    queueWrite(storageKey, data) {
        return new Promise((resolve, reject) => {
            this.writeQueue.push({
                storageKey,
                data,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            // Process queue if not already processing
            if (!this.isProcessingQueue) {
                this.processWriteQueue();
            }
        });
    }

    /**
     * Process the write queue
     */
    async processWriteQueue() {
        if (this.isProcessingQueue || this.writeQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.writeQueue.length > 0) {
            const write = this.writeQueue.shift();
            
            try {
                await this.performWrite(write.storageKey, write.data);
                write.resolve(true);
            } catch (error) {
                write.reject(error);
            }
        }
        
        this.isProcessingQueue = false;
    }

    /**
     * Perform actual write operation
     */
    async performWrite(storageKey, data) {
        const storageType = this.getStorageType(storageKey);
        
        const storageData = {
            ...data,
            _version: this.storageVersions[storageType] || '1.0.0',
            _lastSaved: new Date().toISOString(),
            _checksum: this.generateChecksum(data)
        };
        
        if (this.storageValid) {
            try {
                window.extensionSettings[storageKey] = storageData;
                
                if (typeof window.saveSettings === 'function') {
                    await window.saveSettings();
                }
                
                this.writeOperations++;
                return true;
            } catch (error) {
                this.handleError('write', error, false);
                this.fallbackStorage.set(storageKey, storageData);
                return false;
            }
        } else {
            this.fallbackStorage.set(storageKey, storageData);
            return true;
        }
    }

    /**
     * Save data to storage with metadata
     */
    async saveToStorage(key, data) {
        const storageKey = this.storageKeys[key] || key;
        
        if (this.getConfig('performance.autoSave', true)) {
            return await this.queueWrite(storageKey, data);
        } else {
            return await this.performWrite(storageKey, data);
        }
    }

    /**
     * Load data from storage with validation
     */
    async loadFromStorage(key, defaultValue = null) {
        const storageKey = this.storageKeys[key] || key;
        this.readOperations++;
        
        let data = null;
        
        // Try to load from main storage
        if (this.storageValid && window.extensionSettings[storageKey]) {
            data = window.extensionSettings[storageKey];
            this.cacheHits++;
        } 
        // Fallback to fallback storage
        else if (this.fallbackStorage.has(storageKey)) {
            data = this.fallbackStorage.get(storageKey);
            this.cacheHits++;
        } 
        // No data found
        else {
            this.cacheMisses++;
            return defaultValue;
        }
        
        if (!data) {
            return defaultValue;
        }
        
        // Validate data integrity if checksum exists
        if (data._checksum) {
            const expectedChecksum = this.generateChecksum(data);
            if (data._checksum !== expectedChecksum) {
                this.logWarning(`Checksum mismatch for ${storageKey}, data may be corrupted`);
                return defaultValue;
            }
        }
        
        // Remove metadata before returning
        const { _version, _lastSaved, _checksum, ...cleanData } = data;
        return cleanData;
    }

    /**
     * Save a body map for a character
     */
    async saveBodyMap(id, map) {
        if (!id || typeof id !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        if (!map || typeof map !== 'object') {
            throw new Error('Body map must be an object');
        }
        
        const characters = await this.loadFromStorage('characters', {});
        
        characters[id] = {
            id: id,
            bodyMap: map,
            _lastModified: new Date().toISOString()
        };
        
        const success = await this.saveToStorage('characters', characters);
        
        if (success) {
            this.fireEvent('body-map-saved', { id, map });
        }
        
        return success;
    }

    /**
     * Load a body map for a character
     */
    async loadBodyMap(id) {
        if (!id || typeof id !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        const characters = await this.loadFromStorage('characters', {});
        const character = characters[id];
        
        return character ? character.bodyMap : null;
    }

    /**
     * Save all pending data
     */
    async saveAllPendingData() {
        await this.processWriteQueue();
        
        // Force save all cached data
        for (const [key, data] of this.fallbackStorage.entries()) {
            if (this.storageValid) {
                try {
                    window.extensionSettings[key] = data;
                } catch (error) {
                    this.handleError('final-save', error, false);
                }
            }
        }
        
        if (this.storageValid && typeof window.saveSettings === 'function') {
            await window.saveSettings();
        }
    }

    /**
     * Load all body maps
     */
    async loadAllMaps() {
        const characters = await this.loadFromStorage('characters', {});
        const maps = {};
        
        for (const [id, character] of Object.entries(characters)) {
            if (character.bodyMap) {
                maps[id] = character.bodyMap;
            }
        }
        
        return maps;
    }

    /**
     * Delete a body map
     */
    async deleteBodyMap(id) {
        if (!id || typeof id !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        const characters = await this.loadFromStorage('characters', {});
        
        if (characters[id]) {
            delete characters[id];
            const success = await this.saveToStorage('characters', characters);
            
            if (success) {
                this.fireEvent('body-map-deleted', { id });
            }
            
            return success;
        }
        
        return false;
    }

    /**
     * Check if a body map exists
     */
    async hasBodyMap(id) {
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        const characters = await this.loadFromStorage('characters', {});
        return !!(characters[id] && characters[id].bodyMap);
    }

    /**
     * Get all character IDs
     */
    async getAllCharacterIds() {
        const characters = await this.loadFromStorage('characters', {});
        return Object.keys(characters);
    }

    /**
     * Export all data to JSON
     */
    async exportAllToJson() {
        const characters = await this.loadFromStorage('characters', {});
        const garments = await this.loadFromStorage('garments', {});
        const history = await this.loadFromStorage('history', []);
        const settings = await this.loadFromStorage('settings', {});
        
        return {
            characters,
            garments,
            history,
            settings,
            _exportedAt: new Date().toISOString(),
            _version: '1.0.0'
        };
    }

    /**
     * Import data from JSON
     */
    async importFromJson(jsonData) {
        if (!jsonData || typeof jsonData !== 'object') {
            throw new Error('Invalid JSON data for import');
        }
        
        const results = {
            characters: 0,
            garments: 0,
            history: 0,
            settings: 0,
            errors: []
        };
        
        try {
            if (jsonData.characters) {
                await this.saveToStorage('characters', jsonData.characters);
                results.characters = Object.keys(jsonData.characters).length;
            }
            
            if (jsonData.garments) {
                await this.saveToStorage('garments', jsonData.garments);
                results.garments = Object.keys(jsonData.garments).length;
            }
            
            if (jsonData.history) {
                await this.saveToStorage('history', jsonData.history);
                results.history = jsonData.history.length;
            }
            
            if (jsonData.settings) {
                await this.saveToStorage('settings', jsonData.settings);
                results.settings = Object.keys(jsonData.settings).length;
            }
            
            this.fireEvent('data-imported', results);
            
        } catch (error) {
            results.errors.push(error.message);
            this.handleError('import', error, false);
        }
        
        return results;
    }

    /**
     * Validate storage integrity
     */
    async validateStorage() {
        const results = {
            isValid: true,
            errors: [],
            warnings: [],
            stats: {
                characters: 0,
                garments: 0,
                historyEntries: 0,
                cacheEntries: 0
            }
        };
        
        try {
            // Validate characters
            const characters = await this.loadFromStorage('characters', {});
            results.stats.characters = Object.keys(characters).length;
            
            for (const [id, character] of Object.entries(characters)) {
                if (!character.bodyMap) {
                    results.warnings.push(`Character ${id} has no body map`);
                }
            }
            
            // Validate garments
            const garments = await this.loadFromStorage('garments', {});
            results.stats.garments = Object.keys(garments).length;
            
            // Validate history
            const history = await this.loadFromStorage('history', []);
            results.stats.historyEntries = history.length;
            
            // Validate cache
            const cache = await this.loadFromStorage('cache', {});
            results.stats.cacheEntries = Object.keys(cache).length;
            
        } catch (error) {
            results.isValid = false;
            results.errors.push(error.message);
            this.handleError('validation', error, false);
        }
        
        return results;
    }

    /**
     * Provide fallback functionality when storage fails
     */
    provideFallbackForLayer(layerName) {
        switch (layerName) {
            case 'storage-environment':
                this.logInfo('Using in-memory fallback storage');
                break;
            case 'storage-migration':
                this.logInfo('Skipping storage migration');
                break;
            case 'storage-cleanup':
                this.logInfo('Skipping storage cleanup');
                break;
            default:
                this.logInfo(`Fallback activated for ${layerName}`);
        }
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics() {
        return {
            ...super.getDiagnostics(),
            storageValid: this.storageValid,
            fallbackEntries: this.fallbackStorage.size,
            writeQueueLength: this.writeQueue.length,
            performance: {
                readOperations: this.readOperations,
                writeOperations: this.writeOperations,
                cacheHitRate: this.getCacheHitRate()
            }
        };
    }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftStorageManager;
}

// Global exposure for ST integration
if (typeof window !== 'undefined') {
    window.ThreadshiftStorageManager = ThreadshiftStorageManager;
    
    // Also expose in ST namespace
    window.ThreadshiftST = window.ThreadshiftST || {};
    window.ThreadshiftST.StorageManager = ThreadshiftStorageManager;
}