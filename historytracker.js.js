/**
 * Threadshift History Tracker
 * 
 * Manages transformation history with persistence, validation, and recovery capabilities.
 * Complies with ThreadshiftModule pattern and integrates with storage/config systems.
 */

class ThreadshiftHistoryTracker extends ThreadshiftModule {
    constructor() {
        super('HistoryTracker');
        this.dependencies = ['storage', 'config'];
        
        // Core state
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = 50;
        this.isRecording = true;
        
        // Performance tracking
        this.stats = {
            totalEntries: 0,
            undoOperations: 0,
            redoOperations: 0,
            cleanupOperations: 0,
            storageOperations: 0,
            averageEntrySize: 0
        };
        
        // History entry types
        this.entryTypes = {
            SWAP: 'swap',
            REVERSE: 'reverse',
            BATCH: 'batch',
            MANUAL: 'manual',
            IMPORT: 'import',
            SYSTEM: 'system'
        };
        
        // Validation rules
        this.validationRules = {
            requiredFields: ['id', 'type', 'timestamp', 'data'],
            maxDescriptionLength: 500,
            maxDataSize: 10000, // characters
            validTypes: Object.values(this.entryTypes)
        };
        
        // Storage configuration
        this.storageKey = 'history';
        this.autoSaveEnabled = true;
        this.compressionEnabled = false;
        
        // Event throttling
        this.saveThrottled = this.throttle(this.saveToStorage.bind(this), 1000);
        this.cleanupThrottled = this.throttle(this.performCleanup.bind(this), 30000);
        
        // Setup cleanup task
        this.cleanupTasks.push(() => this.performCleanup());
    }
    
    async initialize() {
        if (!await super.initialize()) return false;
        
        try {
            // Load configuration
            this.loadConfigurationSettings();
            
            // Load existing history
            await this.loadHistoryFromStorage();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Validate loaded history
            await this.validateLoadedHistory();
            
            // Setup auto-save if enabled
            if (this.autoSaveEnabled) {
                this.setupAutoSave();
            }
            
            console.log(`✓ History Tracker initialized with ${this.history.length} entries`);
            return true;
            
        } catch (error) {
            this.handleError('initialize', error, true);
            return false;
        }
    }
    
    loadConfigurationSettings() {
        this.maxHistorySize = this.getConfig('performance.maxHistoryEntries', 50);
        this.autoSaveEnabled = this.getConfig('performance.autoSave', true);
        this.compressionEnabled = this.getConfig('storage.compression', false);
        this.isRecording = this.getConfig('features.historyTracking', true);
        
        // Validate configuration
        if (this.maxHistorySize < 1) this.maxHistorySize = 50;
        if (this.maxHistorySize > 1000) this.maxHistorySize = 1000;
    }
    
    async loadHistoryFromStorage() {
        try {
            const storedHistory = await this.storage.loadFromStorage(this.storageKey, []);
            
            if (Array.isArray(storedHistory) && storedHistory.length > 0) {
                this.history = storedHistory;
                this.currentIndex = this.history.length - 1;
                this.stats.totalEntries = this.history.length;
                
                // Calculate average entry size
                this.calculateAverageEntrySize();
                
                this.fireEvent('history-loaded', { 
                    count: this.history.length,
                    latestTimestamp: this.history[this.history.length - 1]?.timestamp
                });
            }
            
        } catch (error) {
            this.handleError('loadHistoryFromStorage', error);
            this.history = [];
            this.currentIndex = -1;
        }
    }
    
    setupEventListeners() {
        // Listen for transformation events
        this.addEventListener('swap-completed', (data) => {
            this.recordTransformation(this.entryTypes.SWAP, data, 'Garment swap completed');
        });
        
        this.addEventListener('swap-reversed', (data) => {
            this.recordTransformation(this.entryTypes.REVERSE, data, 'Swap reversed');
        });
        
        // Listen for batch operations
        this.addEventListener('batch-operation', (data) => {
            this.recordTransformation(this.entryTypes.BATCH, data, 'Batch operation completed');
        });
        
        // Listen for configuration changes
        this.addEventListener('config-changed', (data) => {
            if (data.key === 'performance.maxHistoryEntries') {
                this.maxHistorySize = data.value;
                this.enforceHistoryLimit();
            }
        });
    }
    
    async validateLoadedHistory() {
        const invalidEntries = [];
        
        for (let i = 0; i < this.history.length; i++) {
            const entry = this.history[i];
            const validation = this.validateHistoryEntry(entry);
            
            if (!validation.valid) {
                invalidEntries.push({ index: i, entry, errors: validation.errors });
            }
        }
        
        if (invalidEntries.length > 0) {
            this.handleError('validateLoadedHistory', 
                new Error(`Found ${invalidEntries.length} invalid history entries`));
            
            // Remove invalid entries
            this.history = this.history.filter((_, index) => 
                !invalidEntries.some(invalid => invalid.index === index));
            
            // Rebuild index
            this.currentIndex = this.history.length - 1;
            
            // Save cleaned history
            await this.saveToStorage();
        }
    }
    
    setupAutoSave() {
        const autoSaveInterval = this.getConfig('performance.autoSaveInterval', 30000);
        
        setInterval(() => {
            if (this.isDirty) {
                this.saveThrottled();
            }
        }, autoSaveInterval);
    }
    
    // === PUBLIC API ===
    
    /**
     * Record a transformation in history
     * @param {string} type - Entry type from entryTypes
     * @param {Object} data - Transformation data
     * @param {string} description - Human-readable description
     * @param {Object} options - Additional options
     * @returns {string} Entry ID
     */
    recordTransformation(type, data, description, options = {}) {
        if (!this.isRecording) {
            return null;
        }
        
        try {
            const entry = this.createHistoryEntry(type, data, description, options);
            const validation = this.validateHistoryEntry(entry);
            
            if (!validation.valid) {
                this.handleError('recordTransformation', 
                    new Error(`Invalid history entry: ${validation.errors.join(', ')}`));
                return null;
            }
            
            // Add to history
            this.addEntryToHistory(entry);
            
            // Fire event
            this.fireEvent('history-entry-added', entry);
            
            // Auto-save if enabled
            if (this.autoSaveEnabled) {
                this.saveThrottled();
            }
            
            return entry.id;
            
        } catch (error) {
            this.handleError('recordTransformation', error);
            return null;
        }
    }
    
    /**
     * Get history entries with optional filtering
     * @param {Object} options - Filter options
     * @returns {Array} History entries
     */
    getHistory(options = {}) {
        let filteredHistory = [...this.history];
        
        // Apply filters
        if (options.type) {
            filteredHistory = filteredHistory.filter(entry => entry.type === options.type);
        }
        
        if (options.characterId) {
            filteredHistory = filteredHistory.filter(entry => 
                entry.data.sourceCharId === options.characterId || 
                entry.data.targetCharId === options.characterId);
        }
        
        if (options.since) {
            const sinceDate = new Date(options.since);
            filteredHistory = filteredHistory.filter(entry => 
                new Date(entry.timestamp) >= sinceDate);
        }
        
        if (options.limit) {
            filteredHistory = filteredHistory.slice(-options.limit);
        }
        
        return filteredHistory;
    }
    
    /**
     * Get a specific history entry by ID
     * @param {string} entryId - Entry ID
     * @returns {Object|null} History entry
     */
    getHistoryEntry(entryId) {
        return this.history.find(entry => entry.id === entryId) || null;
    }
    
    /**
     * Check if undo operation is available
     * @returns {boolean} Can undo
     */
    canUndo() {
        return this.currentIndex >= 0 && this.history.length > 0;
    }
    
    /**
     * Check if redo operation is available
     * @returns {boolean} Can redo
     */
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }
    
    /**
     * Undo last transformation
     * @returns {Promise<Object>} Undo result
     */
    async undo() {
        if (!this.canUndo()) {
            return { success: false, error: 'No operations to undo' };
        }
        
        try {
            const entry = this.history[this.currentIndex];
            
            // Execute undo operation
            const result = await this.executeUndo(entry);
            
            if (result.success) {
                this.currentIndex--;
                this.stats.undoOperations++;
                
                this.fireEvent('history-undo', { entry, result });
                
                return {
                    success: true,
                    entry,
                    result,
                    newIndex: this.currentIndex
                };
            } else {
                return result;
            }
            
        } catch (error) {
            this.handleError('undo', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Redo next transformation
     * @returns {Promise<Object>} Redo result
     */
    async redo() {
        if (!this.canRedo()) {
            return { success: false, error: 'No operations to redo' };
        }
        
        try {
            this.currentIndex++;
            const entry = this.history[this.currentIndex];
            
            // Execute redo operation
            const result = await this.executeRedo(entry);
            
            if (result.success) {
                this.stats.redoOperations++;
                
                this.fireEvent('history-redo', { entry, result });
                
                return {
                    success: true,
                    entry,
                    result,
                    newIndex: this.currentIndex
                };
            } else {
                this.currentIndex--;
                return result;
            }
            
        } catch (error) {
            this.handleError('redo', error);
            this.currentIndex--;
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Clear all history
     * @param {boolean} confirm - Confirmation flag
     * @returns {Promise<boolean>} Success
     */
    async clearHistory(confirm = false) {
        if (!confirm) {
            throw new Error('History clearing requires confirmation');
        }
        
        try {
            const clearedCount = this.history.length;
            
            this.history = [];
            this.currentIndex = -1;
            this.stats.totalEntries = 0;
            
            await this.saveToStorage();
            
            this.fireEvent('history-cleared', { clearedCount });
            
            return true;
            
        } catch (error) {
            this.handleError('clearHistory', error);
            return false;
        }
    }
    
    /**
     * Export history to JSON
     * @param {Object} options - Export options
     * @returns {Object} Export data
     */
    exportHistory(options = {}) {
        const exportData = {
            history: this.getHistory(options),
            stats: { ...this.stats },
            exportedAt: new Date().toISOString(),
            version: '1.0.0'
        };
        
        if (options.includeConfig) {
            exportData.config = {
                maxHistorySize: this.maxHistorySize,
                autoSaveEnabled: this.autoSaveEnabled,
                compressionEnabled: this.compressionEnabled
            };
        }
        
        return exportData;
    }
    
    /**
     * Import history from JSON
     * @param {Object} importData - Import data
     * @param {Object} options - Import options
     * @returns {Promise<Object>} Import result
     */
    async importHistory(importData, options = {}) {
        try {
            const validation = this.validateImportData(importData);
            if (!validation.valid) {
                return { success: false, errors: validation.errors };
            }
            
            const importedHistory = importData.history || [];
            let validEntries = 0;
            let invalidEntries = 0;
            
            // Validate each entry
            for (const entry of importedHistory) {
                const entryValidation = this.validateHistoryEntry(entry);
                if (entryValidation.valid) {
                    validEntries++;
                } else {
                    invalidEntries++;
                }
            }
            
            // Handle import strategy
            if (options.merge) {
                // Merge with existing history
                const mergedHistory = [...this.history, ...importedHistory.filter(entry => 
                    this.validateHistoryEntry(entry).valid)];
                
                // Sort by timestamp
                mergedHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                this.history = mergedHistory;
            } else {
                // Replace existing history
                this.history = importedHistory.filter(entry => 
                    this.validateHistoryEntry(entry).valid);
            }
            
            // Update state
            this.currentIndex = this.history.length - 1;
            this.stats.totalEntries = this.history.length;
            this.enforceHistoryLimit();
            
            // Save imported history
            await this.saveToStorage();
            
            this.fireEvent('history-imported', { 
                validEntries, 
                invalidEntries, 
                totalEntries: this.history.length 
            });
            
            return {
                success: true,
                validEntries,
                invalidEntries,
                totalEntries: this.history.length
            };
            
        } catch (error) {
            this.handleError('importHistory', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Get history statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.stats,
            currentEntries: this.history.length,
            maxHistorySize: this.maxHistorySize,
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            currentIndex: this.currentIndex,
            memoryUsage: this.calculateMemoryUsage()
        };
    }
    
    // === PRIVATE METHODS ===
    
    createHistoryEntry(type, data, description, options = {}) {
        const entry = {
            id: this.generateEntryId(),
            type,
            description,
            timestamp: new Date().toISOString(),
            data: this.cloneData(data),
            metadata: {
                version: '1.0.0',
                source: options.source || 'user',
                sessionId: options.sessionId || null,
                undoable: options.undoable !== false
            }
        };
        
        // Add reversal data if available
        if (options.reversalData) {
            entry.reversalData = this.cloneData(options.reversalData);
        }
        
        return entry;
    }
    
    validateHistoryEntry(entry) {
        const errors = [];
        
        // Check required fields
        for (const field of this.validationRules.requiredFields) {
            if (!entry[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // Check type validity
        if (entry.type && !this.validationRules.validTypes.includes(entry.type)) {
            errors.push(`Invalid entry type: ${entry.type}`);
        }
        
        // Check description length
        if (entry.description && entry.description.length > this.validationRules.maxDescriptionLength) {
            errors.push(`Description too long (max ${this.validationRules.maxDescriptionLength} chars)`);
        }
        
        // Check data size
        if (entry.data) {
            const dataSize = JSON.stringify(entry.data).length;
            if (dataSize > this.validationRules.maxDataSize) {
                errors.push(`Data too large (max ${this.validationRules.maxDataSize} chars)`);
            }
        }
        
        // Check timestamp validity
        if (entry.timestamp && isNaN(Date.parse(entry.timestamp))) {
            errors.push('Invalid timestamp format');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    validateImportData(importData) {
        const errors = [];
        
        if (!importData || typeof importData !== 'object') {
            errors.push('Import data must be an object');
            return { valid: false, errors };
        }
        
        if (!Array.isArray(importData.history)) {
            errors.push('Import data must contain a history array');
        }
        
        if (importData.version && importData.version !== '1.0.0') {
            errors.push(`Unsupported version: ${importData.version}`);
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    addEntryToHistory(entry) {
        // If we're not at the end, remove entries after current position
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        
        // Add new entry
        this.history.push(entry);
        this.currentIndex = this.history.length - 1;
        this.stats.totalEntries++;
        
        // Enforce history limit
        this.enforceHistoryLimit();
        
        // Mark as dirty for auto-save
        this.isDirty = true;
    }
    
    enforceHistoryLimit() {
        if (this.history.length > this.maxHistorySize) {
            const excess = this.history.length - this.maxHistorySize;
            this.history = this.history.slice(excess);
            this.currentIndex = Math.max(0, this.currentIndex - excess);
        }
    }
    
    async executeUndo(entry) {
        // This would integrate with the transformation engine
        // For now, return a placeholder result
        return {
            success: true,
            message: `Undid ${entry.type} operation`,
            timestamp: new Date().toISOString()
        };
    }
    
    async executeRedo(entry) {
        // This would integrate with the transformation engine
        // For now, return a placeholder result
        return {
            success: true,
            message: `Redid ${entry.type} operation`,
            timestamp: new Date().toISOString()
        };
    }
    
    async saveToStorage() {
        try {
            await this.storage.saveToStorage(this.storageKey, this.history);
            this.stats.storageOperations++;
            this.isDirty = false;
            
            this.fireEvent('history-saved', { 
                entries: this.history.length,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.handleError('saveToStorage', error);
        }
    }
    
    performCleanup() {
        // Remove old entries beyond limit
        this.enforceHistoryLimit();
        
        // Cleanup orphaned references
        this.cleanupOrphanedReferences();
        
        // Update stats
        this.stats.cleanupOperations++;
        
        this.fireEvent('history-cleanup', { 
            entries: this.history.length,
            timestamp: new Date().toISOString()
        });
    }
    
    cleanupOrphanedReferences() {
        // Remove entries that reference non-existent characters/garments
        // This would integrate with character/garment management
        const beforeCount = this.history.length;
        
        // Placeholder cleanup logic
        this.history = this.history.filter(entry => {
            return entry.data && typeof entry.data === 'object';
        });
        
        const afterCount = this.history.length;
        if (beforeCount !== afterCount) {
            this.currentIndex = Math.min(this.currentIndex, afterCount - 1);
        }
    }
    
    calculateAverageEntrySize() {
        if (this.history.length === 0) {
            this.stats.averageEntrySize = 0;
            return;
        }
        
        const totalSize = this.history.reduce((sum, entry) => {
            return sum + JSON.stringify(entry).length;
        }, 0);
        
        this.stats.averageEntrySize = Math.round(totalSize / this.history.length);
    }
    
    calculateMemoryUsage() {
        const historySize = JSON.stringify(this.history).length;
        return {
            historySize,
            averageEntrySize: this.stats.averageEntrySize,
            totalEntries: this.history.length
        };
    }
    
    generateEntryId() {
        return `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    cloneData(data) {
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            this.handleError('cloneData', error);
            return data;
        }
    }
    
    // === MODULE LIFECYCLE ===
    
    async shutdown() {
        // Save any pending changes
        if (this.isDirty) {
            await this.saveToStorage();
        }
        
        // Cleanup
        this.performCleanup();
        
        await super.shutdown();
    }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftHistoryTracker;
}