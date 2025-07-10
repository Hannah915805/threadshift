/**
 * ThreadshiftZoneSwapEngine
 * 
 * Handles the execution of transformation swaps between characters based on garments and affected body zones.
 * Part of the Threadshift Core Engine plugin.
 * 
 * @extends ThreadshiftModule
 */
class ThreadshiftZoneSwapEngine extends ThreadshiftModule {
    constructor() {
        super('ZoneSwapEngine');
        this.dependencies = ['storage', 'config', 'garmentZoneMapper', 'bodyMapValidator'];
        
        // Core state
        this.activeSwaps = new Map();
        this.swapHistory = [];
        this.swapCounter = 0;
        
        // Dependencies (will be injected)
        this.garmentZoneMapper = null;
        this.bodyMapValidator = null;
        this.reciprocalSwapHandler = null;
        
        // Settings with defaults
        this.settings = {
            bidirectionalSwaps: true,
            autoValidation: true,
            historyLimit: 100,
            debugMode: false,
            validateTransformations: true,
            allowPartialTransformations: true,
            strictZoneMatching: false,
            reciprocalTransformations: true,
            conflictResolution: 'merge',
            maxTransformationDepth: 10
        };
        
        // Performance tracking
        this.stats = {
            totalSwaps: 0,
            successfulSwaps: 0,
            failedSwaps: 0,
            reversedSwaps: 0,
            validationErrors: 0
        };
    }
    
    async initialize() {
        if (!await super.initialize()) return false;
        
        try {
            // Load settings from config
            this.loadSettingsFromConfig();
            
            // Validate dependencies
            if (!this.validateDependencies()) {
                throw new Error('Required dependencies not available');
            }
            
            // Initialize swap tracking
            this.initializeSwapTracking();
            
            // Setup event listeners
            this.setupEventListeners();
            
            this.initialized = true;
            return true;
            
        } catch (error) {
            this.handleError('initialize', error, true);
            return false;
        }
    }
    
    loadSettingsFromConfig() {
        if (!this.config) return;
        
        const engineConfig = this.config.get('engine') || {};
        this.settings = {
            ...this.settings,
            validateTransformations: engineConfig.validateTransformations ?? this.settings.validateTransformations,
            allowPartialTransformations: engineConfig.allowPartialTransformations ?? this.settings.allowPartialTransformations,
            strictZoneMatching: engineConfig.strictZoneMatching ?? this.settings.strictZoneMatching,
            reciprocalTransformations: engineConfig.reciprocalTransformations ?? this.settings.reciprocalTransformations,
            conflictResolution: engineConfig.conflictResolution ?? this.settings.conflictResolution,
            maxTransformationDepth: engineConfig.maxTransformationDepth ?? this.settings.maxTransformationDepth
        };
        
        const performanceConfig = this.config.get('performance') || {};
        this.settings.historyLimit = performanceConfig.maxHistoryEntries ?? this.settings.historyLimit;
        
        const debugConfig = this.config.get('debug') || {};
        this.settings.debugMode = debugConfig.enabled ?? this.settings.debugMode;
    }
    
    validateDependencies() {
        // Check for required dependencies
        const requiredDeps = ['garmentZoneMapper', 'bodyMapValidator'];
        
        for (const dep of requiredDeps) {
            if (!this[dep]) {
                this.handleError('validateDependencies', new Error(`Missing required dependency: ${dep}`), true);
                return false;
            }
        }
        
        return true;
    }
    
    initializeSwapTracking() {
        this.activeSwaps.clear();
        this.swapHistory = [];
        this.swapCounter = 0;
        this.stats = {
            totalSwaps: 0,
            successfulSwaps: 0,
            failedSwaps: 0,
            reversedSwaps: 0,
            validationErrors: 0
        };
    }
    
    setupEventListeners() {
        // Listen for configuration changes
        if (this.config) {
            this.addEventListener('config-changed', (event) => {
                this.loadSettingsFromConfig();
            });
        }
        
        // Listen for cleanup events
        this.addEventListener('cleanup-requested', () => {
            this.performCleanup();
        });
    }
    
    /**
     * Performs a validated transformation based on a garment ID
     * @param {string} sourceCharId - Source character ID
     * @param {string} targetCharId - Target character ID
     * @param {string} garmentId - Garment ID to base transformation on
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Swap result with success status and details
     */
    async performSwap(sourceCharId, targetCharId, garmentId, options = {}) {
        if (!this.isReady()) {
            throw new Error('ZoneSwapEngine not ready');
        }
        
        return await this.safeOperation('performSwap', async () => {
            this.stats.totalSwaps++;
            
            // Validate inputs
            if (!sourceCharId || !targetCharId || !garmentId) {
                throw new Error('Missing required parameters: sourceCharId, targetCharId, garmentId');
            }
            
            if (sourceCharId === targetCharId) {
                throw new Error('Source and target characters cannot be the same');
            }
            
            // Get garment information
            const garment = await this.getGarmentById(garmentId);
            if (!garment) {
                throw new Error(`Garment not found: ${garmentId}`);
            }
            
            // Resolve affected zones
            const zones = await this.getZonesForGarment(garment.type);
            if (!zones || zones.length === 0) {
                throw new Error(`No zones found for garment type: ${garment.type}`);
            }
            
            // Load character body maps
            const sourceBodyMap = await this.loadCharacterBodyMap(sourceCharId);
            const targetBodyMap = await this.loadCharacterBodyMap(targetCharId);
            
            // Validate swap if enabled
            if (this.settings.autoValidation && this.settings.validateTransformations) {
                const validation = await this.validateSwap(sourceBodyMap, targetBodyMap, zones);
                if (!validation.valid) {
                    this.stats.validationErrors++;
                    if (!this.settings.allowPartialTransformations) {
                        throw new Error(`Swap validation failed: ${validation.errors.join(', ')}`);
                    }
                }
            }
            
            // Execute the swap
            const swapResult = await this.executeSwap(sourceCharId, targetCharId, zones, garment, options);
            
            this.stats.successfulSwaps++;
            this.fireEvent('swap-completed', swapResult);
            
            return swapResult;
            
        }, null);
    }
    
    /**
     * Executes the actual swap operation
     * @param {string} sourceCharId - Source character ID
     * @param {string} targetCharId - Target character ID
     * @param {Array} zones - Zones to swap
     * @param {Object} garment - Garment information
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Swap execution result
     */
    async executeSwap(sourceCharId, targetCharId, zones, garment, options = {}) {
        const swapId = this.generateSwapId();
        const timestamp = new Date().toISOString();
        
        const swapData = {
            id: swapId,
            sourceCharId,
            targetCharId,
            zones: [...zones],
            garment,
            timestamp,
            status: 'active',
            options,
            reciprocal: this.settings.reciprocalTransformations && this.settings.bidirectionalSwaps
        };
        
        try {
            // Load current body maps
            const sourceBodyMap = await this.loadCharacterBodyMap(sourceCharId);
            const targetBodyMap = await this.loadCharacterBodyMap(targetCharId);
            
            // Store original states for potential reversal
            swapData.originalStates = {
                source: this.cloneBodyMapZones(sourceBodyMap, zones),
                target: this.cloneBodyMapZones(targetBodyMap, zones)
            };
            
            // Perform zone swaps
            const swapResults = [];
            for (const zone of zones) {
                const zoneResult = await this.applyZoneSwap(sourceCharId, targetCharId, zone, swapId, options);
                swapResults.push(zoneResult);
            }
            
            // Handle reciprocal transformations
            if (swapData.reciprocal && this.reciprocalSwapHandler) {
                await this.reciprocalSwapHandler.handleReciprocal(swapData);
            }
            
            // Store active swap
            this.activeSwaps.set(swapId, swapData);
            
            // Add to history
            this.addToHistory(swapData);
            
            // Fire completion events
            this.fireEvent('threadshift_swap_executed', {
                swapId,
                sourceCharId,
                targetCharId,
                zones,
                garment,
                success: true
            });
            
            return {
                success: true,
                swapId,
                zones,
                results: swapResults,
                timestamp
            };
            
        } catch (error) {
            this.stats.failedSwaps++;
            swapData.status = 'failed';
            swapData.error = error.message;
            
            this.handleError('executeSwap', error, false);
            
            return {
                success: false,
                swapId,
                error: error.message,
                timestamp
            };
        }
    }
    
    /**
     * Applies a zone-specific swap between two characters
     * @param {string} sourceCharId - Source character ID
     * @param {string} targetCharId - Target character ID
     * @param {string} zone - Body zone to swap
     * @param {string} swapId - Swap operation ID
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Zone swap result
     */
    async applyZoneSwap(sourceCharId, targetCharId, zone, swapId, options = {}) {
        try {
            // Load current body maps
            const sourceBodyMap = await this.loadCharacterBodyMap(sourceCharId);
            const targetBodyMap = await this.loadCharacterBodyMap(targetCharId);
            
            if (!sourceBodyMap || !targetBodyMap) {
                throw new Error(`Missing body map for character`);
            }
            
            // Get zone data
            const sourceZoneData = sourceBodyMap[zone];
            const targetZoneData = targetBodyMap[zone];
            
            // Perform the swap
            const updatedSourceMap = { ...sourceBodyMap, [zone]: targetZoneData };
            const updatedTargetMap = { ...targetBodyMap, [zone]: sourceZoneData };
            
            // Save updated body maps
            await this.saveCharacterBodyMap(sourceCharId, updatedSourceMap);
            await this.saveCharacterBodyMap(targetCharId, updatedTargetMap);
            
            // Fire zone-specific event
            this.fireEvent('threadshift_zone_swap', {
                swapId,
                sourceCharId,
                targetCharId,
                zone,
                sourceData: sourceZoneData,
                targetData: targetZoneData
            });
            
            return {
                zone,
                success: true,
                sourceData: sourceZoneData,
                targetData: targetZoneData
            };
            
        } catch (error) {
            this.handleError('applyZoneSwap', error, false);
            return {
                zone,
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Reverses a previous swap operation
     * @param {string} swapId - ID of swap to reverse
     * @returns {Promise<Object>} Reversal result
     */
    async reverseSwap(swapId) {
        if (!this.isReady()) {
            throw new Error('ZoneSwapEngine not ready');
        }
        
        return await this.safeOperation('reverseSwap', async () => {
            const swapData = this.activeSwaps.get(swapId);
            if (!swapData) {
                throw new Error(`Active swap not found: ${swapId}`);
            }
            
            if (swapData.status !== 'active') {
                throw new Error(`Swap ${swapId} is not in active state: ${swapData.status}`);
            }
            
            if (!swapData.originalStates) {
                throw new Error(`No original states stored for swap ${swapId}`);
            }
            
            try {
                // Restore original states
                const sourceBodyMap = await this.loadCharacterBodyMap(swapData.sourceCharId);
                const targetBodyMap = await this.loadCharacterBodyMap(swapData.targetCharId);
                
                // Restore source zones
                const restoredSourceMap = {
                    ...sourceBodyMap,
                    ...swapData.originalStates.source
                };
                
                // Restore target zones
                const restoredTargetMap = {
                    ...targetBodyMap,
                    ...swapData.originalStates.target
                };
                
                // Save restored maps
                await this.saveCharacterBodyMap(swapData.sourceCharId, restoredSourceMap);
                await this.saveCharacterBodyMap(swapData.targetCharId, restoredTargetMap);
                
                // Update swap status
                swapData.status = 'reversed';
                swapData.reversedAt = new Date().toISOString();
                
                // Remove from active swaps
                this.activeSwaps.delete(swapId);
                
                // Update history
                this.updateHistoryEntry(swapId, swapData);
                
                this.stats.reversedSwaps++;
                
                this.fireEvent('swap-reversed', {
                    swapId,
                    sourceCharId: swapData.sourceCharId,
                    targetCharId: swapData.targetCharId,
                    zones: swapData.zones
                });
                
                return {
                    success: true,
                    swapId,
                    reversedAt: swapData.reversedAt
                };
                
            } catch (error) {
                this.handleError('reverseSwap', error, false);
                return {
                    success: false,
                    swapId,
                    error: error.message
                };
            }
        }, null);
    }
    
    /**
     * Validates a potential swap operation
     * @param {Object} sourceBodyMap - Source character body map
     * @param {Object} targetBodyMap - Target character body map
     * @param {Array} zones - Zones to validate
     * @returns {Promise<Object>} Validation result
     */
    async validateSwap(sourceBodyMap, targetBodyMap, zones) {
        if (!this.bodyMapValidator) {
            return { valid: true, warnings: ['Body map validator not available'] };
        }
        
        try {
            const validation = await this.bodyMapValidator.validateSwap(sourceBodyMap, targetBodyMap, zones);
            return validation;
        } catch (error) {
            this.handleError('validateSwap', error, false);
            return {
                valid: false,
                errors: [`Validation failed: ${error.message}`]
            };
        }
    }
    
    /**
     * Gets garment information by ID
     * @param {string} garmentId - Garment ID in format "CHARACTERID.TYPEINDEX"
     * @returns {Promise<Object>} Garment information
     */
    async getGarmentById(garmentId) {
        if (!garmentId || typeof garmentId !== 'string') {
            throw new Error('Invalid garment ID');
        }
        
        // Parse garment ID format: CHARACTERID.TYPEINDEX
        const parts = garmentId.split('.');
        if (parts.length !== 2) {
            throw new Error(`Invalid garment ID format: ${garmentId}`);
        }
        
        const [characterId, typeIndex] = parts;
        
        // Get garment from inventory or create default
        // This would typically interface with the garment inventory system
        const garmentTypes = [
            'bra', 'panties', 'dress', 'shirt', 'pants', 'skirt', 'shoes', 'socks'
        ];
        
        const typeIndexNum = parseInt(typeIndex, 10);
        if (isNaN(typeIndexNum) || typeIndexNum < 0 || typeIndexNum >= garmentTypes.length) {
            throw new Error(`Invalid garment type index: ${typeIndex}`);
        }
        
        const garmentType = garmentTypes[typeIndexNum];
        
        return {
            id: garmentId,
            characterId,
            type: garmentType,
            zones: await this.getZonesForGarment(garmentType)
        };
    }
    
    /**
     * Gets affected zones for a garment type
     * @param {string} garmentType - Type of garment
     * @returns {Promise<Array>} Array of affected zones
     */
    async getZonesForGarment(garmentType) {
        if (this.garmentZoneMapper) {
            return await this.garmentZoneMapper.getZonesForGarment(garmentType);
        }
        
        // Fallback zone mapping
        const zoneMapping = {
            'bra': ['chest'],
            'panties': ['genitals'],
            'dress': ['chest', 'waist', 'hips'],
            'shirt': ['chest', 'waist'],
            'pants': ['waist', 'hips', 'legs'],
            'skirt': ['waist', 'hips'],
            'shoes': ['feet'],
            'socks': ['feet']
        };
        
        return zoneMapping[garmentType] || [];
    }
    
    /**
     * Loads character body map from storage
     * @param {string} characterId - Character ID
     * @returns {Promise<Object>} Body map data
     */
    async loadCharacterBodyMap(characterId) {
        if (!this.dependencies.includes('storage') || !window.Threadshift?.foundation?.storage) {
            throw new Error('Storage dependency not available');
        }
        
        const storage = window.Threadshift.foundation.storage;
        return await storage.loadBodyMap(characterId);
    }
    
    /**
     * Saves character body map to storage
     * @param {string} characterId - Character ID
     * @param {Object} bodyMap - Body map data
     * @returns {Promise<boolean>} Success status
     */
    async saveCharacterBodyMap(characterId, bodyMap) {
        if (!this.dependencies.includes('storage') || !window.Threadshift?.foundation?.storage) {
            throw new Error('Storage dependency not available');
        }
        
        const storage = window.Threadshift.foundation.storage;
        return await storage.saveBodyMap(characterId, bodyMap);
    }
    
    /**
     * Clones specific zones from a body map
     * @param {Object} bodyMap - Source body map
     * @param {Array} zones - Zones to clone
     * @returns {Object} Cloned zone data
     */
    cloneBodyMapZones(bodyMap, zones) {
        const cloned = {};
        for (const zone of zones) {
            if (bodyMap && bodyMap[zone]) {
                cloned[zone] = JSON.parse(JSON.stringify(bodyMap[zone]));
            }
        }
        return cloned;
    }
    
    /**
     * Generates a unique swap ID
     * @returns {string} Unique swap ID
     */
    generateSwapId() {
        return `swap_${Date.now()}_${++this.swapCounter}`;
    }
    
    /**
     * Adds swap data to history
     * @param {Object} swapData - Swap data to add
     */
    addToHistory(swapData) {
        this.swapHistory.unshift(swapData);
        
        // Maintain history limit
        if (this.swapHistory.length > this.settings.historyLimit) {
            this.swapHistory = this.swapHistory.slice(0, this.settings.historyLimit);
        }
    }
    
    /**
     * Updates an existing history entry
     * @param {string} swapId - Swap ID to update
     * @param {Object} updatedData - Updated swap data
     */
    updateHistoryEntry(swapId, updatedData) {
        const index = this.swapHistory.findIndex(entry => entry.id === swapId);
        if (index !== -1) {
            this.swapHistory[index] = { ...this.swapHistory[index], ...updatedData };
        }
    }
    
    /**
     * Gets current active swaps
     * @returns {Array} Array of active swap data
     */
    getActiveSwaps() {
        return Array.from(this.activeSwaps.values());
    }
    
    /**
     * Gets swap history
     * @param {number} limit - Maximum number of entries to return
     * @returns {Array} Array of historical swap data
     */
    getSwapHistory(limit = null) {
        if (limit && limit > 0) {
            return this.swapHistory.slice(0, limit);
        }
        return [...this.swapHistory];
    }
    
    /**
     * Clears swap history
     */
    clearHistory() {
        this.swapHistory = [];
        this.fireEvent('history-cleared');
    }
    
    /**
     * Updates engine settings
     * @param {Object} newSettings - Settings to update
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.fireEvent('settings-updated', this.settings);
    }
    
    /**
     * Gets current engine status
     * @returns {Object} Engine status information
     */
    getStatus() {
        return {
            initialized: this.initialized,
            enabled: this.enabled,
            activeSwaps: this.activeSwaps.size,
            historyEntries: this.swapHistory.length,
            settings: { ...this.settings },
            stats: { ...this.stats }
        };
    }
    
    /**
     * Performs cleanup operations
     */
    performCleanup() {
        // Clean up old history entries
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
        this.swapHistory = this.swapHistory.filter(entry => {
            const entryTime = new Date(entry.timestamp).getTime();
            return entryTime > cutoffTime;
        });
        
        // Clean up failed swaps from active list
        for (const [swapId, swapData] of this.activeSwaps.entries()) {
            if (swapData.status === 'failed') {
                this.activeSwaps.delete(swapId);
            }
        }
        
        this.fireEvent('cleanup-completed');
    }
    
    /**
     * Test method for verification
     * @returns {string} Version string
     */
    test() {
        return 'ThreadshiftZoneSwapEngine v1.0.0';
    }
    
    /**
     * Shutdown the engine
     */
    async shutdown() {
        this.activeSwaps.clear();
        this.swapHistory = [];
        this.swapCounter = 0;
        
        await super.shutdown();
    }
}

// Export for both browser and Node.js environments
if (typeof window !== 'undefined') {
    window.ThreadshiftZoneSwapEngine = ThreadshiftZoneSwapEngine;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftZoneSwapEngine;
}