/**
 * ThreadshiftMultiCharacterHandler
 * 
 * Enables seamless switching and isolated management of multiple characters
 * within Threadshift. Supports group chats, multi-perspective roleplay,
 * and dynamic transformation states per character.
 * 
 * File: threadshift-complete/core/management/multi-character-handler.js
 * Export: window.MultiCharacterHandler
 */

class ThreadshiftMultiCharacterHandler extends ThreadshiftModule {
    constructor() {
        super('MultiCharacterHandler');
        this.dependencies = ['storage', 'config', 'sessionManager', 'historyTracker'];
        
        // Character management
        this.activeCharacterId = null;
        this.characterCache = new Map();
        this.characterMetadata = new Map();
        this.lastAccessTimes = new Map();
        
        // Memory management
        this.maxCachedCharacters = 50;
        this.maxMemoryMB = 100;
        this.cacheEvictionPolicy = 'LRU';
        this.memoryUsageBytes = 0;
        this.cleanupInterval = null;
        
        // Performance tracking
        this.stats = {
            totalCharacters: 0,
            cachedCharacters: 0,
            switchOperations: 0,
            cacheHits: 0,
            cacheMisses: 0,
            evictions: 0,
            memoryPressureEvents: 0
        };
        
        // State management
        this.characterStates = new Map();
        this.pendingStateWrites = new Set();
        this.isProcessingSwitches = false;
        
        // Configuration
        this.defaultCharacterId = 'player001';
        this.autoSaveEnabled = true;
        this.backgroundCleanupEnabled = true;
        this.memoryThresholdMB = 80;
        
        // Event handlers
        this.switchHandlers = new Map();
        this.stateChangeHandlers = new Map();
    }
    
    async initialize() {
        if (!await super.initialize()) return false;
        
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize character cache
            await this.initializeCharacterCache();
            
            // Load character metadata
            await this.loadCharacterMetadata();
            
            // Set up default character if needed
            await this.ensureDefaultCharacter();
            
            // Start background cleanup
            if (this.backgroundCleanupEnabled) {
                this.startBackgroundCleanup();
            }
            
            // Set up event listeners
            this.setupEventListeners();
            
            this.fireEvent('multi-character-initialized', {
                totalCharacters: this.stats.totalCharacters,
                activeCharacter: this.activeCharacterId
            });
            
            return true;
            
        } catch (error) {
            this.handleError('initialize', error, true);
            return false;
        }
    }
    
    async shutdown() {
        try {
            // Save all pending states
            await this.saveAllPendingStates();
            
            // Stop background cleanup
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            
            // Clear caches
            this.characterCache.clear();
            this.characterMetadata.clear();
            this.lastAccessTimes.clear();
            this.characterStates.clear();
            
            await super.shutdown();
            
        } catch (error) {
            this.handleError('shutdown', error, false);
        }
    }
    
    // === CONFIGURATION ===
    
    async loadConfiguration() {
        const config = this.config.get('multiCharacter', {});
        
        this.maxCachedCharacters = config.maxCharacters || 50;
        this.maxMemoryMB = config.memoryThresholdMB || 100;
        this.cacheEvictionPolicy = config.cacheEvictionPolicy || 'LRU';
        this.defaultCharacterId = config.defaultCharacterId || 'player001';
        this.autoSaveEnabled = config.autoSave !== false;
        this.backgroundCleanupEnabled = config.backgroundCleanup !== false;
        this.memoryThresholdMB = config.memoryThresholdMB || 80;
        
        // Update performance settings
        const cleanupInterval = config.cleanupIntervalSeconds || 60;
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.logInfo('Configuration loaded', {
            maxCachedCharacters: this.maxCachedCharacters,
            maxMemoryMB: this.maxMemoryMB,
            defaultCharacterId: this.defaultCharacterId
        });
    }
    
    // === CHARACTER MANAGEMENT ===
    
    async switchCharacter(characterId, options = {}) {
        if (!characterId || typeof characterId !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        if (this.isProcessingSwitches && !options.force) {
            throw new Error('Character switch already in progress');
        }
        
        const oldCharacterId = this.activeCharacterId;
        
        try {
            this.isProcessingSwitches = true;
            
            // Validate character exists or can be created
            const characterExists = await this.characterExists(characterId);
            if (!characterExists && !options.createIfMissing) {
                throw new Error(`Character '${characterId}' not found`);
            }
            
            // Save current character state if needed
            if (oldCharacterId && oldCharacterId !== characterId) {
                await this.saveCharacterState(oldCharacterId);
            }
            
            // Load new character state
            const characterState = await this.loadCharacterState(characterId);
            
            // Update active character
            this.activeCharacterId = characterId;
            this.lastAccessTimes.set(characterId, Date.now());
            
            // Update statistics
            this.stats.switchOperations++;
            
            // Fire events
            this.fireEvent('character-switched', {
                from: oldCharacterId,
                to: characterId,
                state: characterState
            });
            
            // Fire global event for other systems
            window.dispatchEvent(new CustomEvent('threadshift_character_switched', {
                detail: { from: oldCharacterId, to: characterId }
            }));
            
            this.logInfo('Character switched', {
                from: oldCharacterId,
                to: characterId,
                cacheSize: this.characterCache.size
            });
            
            return {
                success: true,
                from: oldCharacterId,
                to: characterId,
                state: characterState
            };
            
        } catch (error) {
            this.handleError('switchCharacter', error, false);
            throw error;
            
        } finally {
            this.isProcessingSwitches = false;
        }
    }
    
    getCurrentCharacter() {
        return this.activeCharacterId;
    }
    
    async getCurrentCharacterState() {
        if (!this.activeCharacterId) {
            return null;
        }
        
        return await this.loadCharacterState(this.activeCharacterId);
    }
    
    async characterExists(characterId) {
        // Check cache first
        if (this.characterCache.has(characterId)) {
            return true;
        }
        
        // Check storage
        const hasBodyMap = await this.storage.hasBodyMap(characterId);
        return hasBodyMap;
    }
    
    async createCharacter(characterId, initialState = {}) {
        if (!characterId || typeof characterId !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        if (await this.characterExists(characterId)) {
            throw new Error(`Character '${characterId}' already exists`);
        }
        
        // Create default character state
        const defaultState = this.createDefaultCharacterState();
        const characterState = { ...defaultState, ...initialState };
        
        // Save to storage
        await this.storage.saveBodyMap(characterId, characterState.bodyMap || {});
        
        // Cache the character
        this.cacheCharacter(characterId, characterState);
        
        // Update metadata
        this.characterMetadata.set(characterId, {
            id: characterId,
            created: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            isNPC: initialState.isNPC || false,
            displayName: initialState.displayName || characterId
        });
        
        // Update stats
        this.stats.totalCharacters++;
        
        this.fireEvent('character-created', {
            characterId,
            state: characterState
        });
        
        return characterState;
    }
    
    async deleteCharacter(characterId) {
        if (!characterId || typeof characterId !== 'string') {
            throw new Error('Character ID must be a non-empty string');
        }
        
        // Can't delete active character
        if (this.activeCharacterId === characterId) {
            throw new Error('Cannot delete active character');
        }
        
        // Remove from cache
        this.characterCache.delete(characterId);
        this.characterStates.delete(characterId);
        this.lastAccessTimes.delete(characterId);
        this.characterMetadata.delete(characterId);
        
        // Remove from storage
        await this.storage.deleteBodyMap(characterId);
        
        // Update stats
        this.stats.totalCharacters--;
        this.stats.cachedCharacters = this.characterCache.size;
        
        this.fireEvent('character-deleted', { characterId });
        
        return true;
    }
    
    // === STATE MANAGEMENT ===
    
    async loadCharacterState(characterId) {
        if (!characterId) {
            return null;
        }
        
        // Check cache first
        if (this.characterCache.has(characterId)) {
            const cachedState = this.characterCache.get(characterId);
            this.lastAccessTimes.set(characterId, Date.now());
            this.stats.cacheHits++;
            return cachedState;
        }
        
        // Load from storage
        this.stats.cacheMisses++;
        
        try {
            const bodyMap = await this.storage.loadBodyMap(characterId);
            
            if (!bodyMap) {
                // Character doesn't exist, create default if this is the default character
                if (characterId === this.defaultCharacterId) {
                    return await this.createCharacter(characterId);
                }
                return null;
            }
            
            // Create character state
            const characterState = {
                currentBody: characterId,
                originalBody: characterId,
                bodyMap: bodyMap,
                inventory: [],
                dialog: {},
                tone: 'supportive',
                lastSwap: null,
                transformationState: {},
                npcMetadata: {},
                isNPC: false,
                displayName: characterId,
                created: new Date().toISOString(),
                lastModified: new Date().toISOString()
            };
            
            // Cache the state
            this.cacheCharacter(characterId, characterState);
            
            return characterState;
            
        } catch (error) {
            this.handleError('loadCharacterState', error, false);
            return null;
        }
    }
    
    async saveCharacterState(characterId, state = null) {
        if (!characterId) {
            return false;
        }
        
        try {
            // Get state from cache or parameter
            const characterState = state || this.characterCache.get(characterId);
            
            if (!characterState) {
                this.logWarning(`No state found for character ${characterId}`);
                return false;
            }
            
            // Save body map to storage
            if (characterState.bodyMap) {
                await this.storage.saveBodyMap(characterId, characterState.bodyMap);
            }
            
            // Update metadata
            if (this.characterMetadata.has(characterId)) {
                const metadata = this.characterMetadata.get(characterId);
                metadata.lastModified = new Date().toISOString();
                this.characterMetadata.set(characterId, metadata);
            }
            
            // Remove from pending writes
            this.pendingStateWrites.delete(characterId);
            
            this.fireEvent('character-state-saved', {
                characterId,
                state: characterState
            });
            
            return true;
            
        } catch (error) {
            this.handleError('saveCharacterState', error, false);
            return false;
        }
    }
    
    async saveAllPendingStates() {
        const savePromises = Array.from(this.pendingStateWrites).map(characterId => 
            this.saveCharacterState(characterId)
        );
        
        await Promise.allSettled(savePromises);
        this.pendingStateWrites.clear();
    }
    
    // === CACHE MANAGEMENT ===
    
    cacheCharacter(characterId, state) {
        if (!characterId || !state) {
            return false;
        }
        
        // Calculate memory usage
        const stateSize = this.calculateStateSize(state);
        
        // Check memory limits
        if (this.memoryUsageBytes + stateSize > this.maxMemoryMB * 1024 * 1024) {
            this.evictCharacters(stateSize);
        }
        
        // Check cache size limits
        if (this.characterCache.size >= this.maxCachedCharacters) {
            this.evictCharacters(0);
        }
        
        // Cache the character
        this.characterCache.set(characterId, state);
        this.characterStates.set(characterId, state);
        this.lastAccessTimes.set(characterId, Date.now());
        
        // Update memory usage
        this.memoryUsageBytes += stateSize;
        
        // Update stats
        this.stats.cachedCharacters = this.characterCache.size;
        
        return true;
    }
    
    evictCharacters(requiredBytes = 0) {
        if (this.characterCache.size === 0) {
            return;
        }
        
        // Sort by access time (LRU)
        const sortedCharacters = Array.from(this.lastAccessTimes.entries())
            .filter(([charId]) => charId !== this.activeCharacterId) // Never evict active character
            .sort(([, timeA], [, timeB]) => timeA - timeB);
        
        let bytesFreed = 0;
        const toEvict = [];
        
        // Determine how many to evict
        for (const [characterId] of sortedCharacters) {
            const state = this.characterCache.get(characterId);
            if (state) {
                const stateSize = this.calculateStateSize(state);
                toEvict.push({ characterId, stateSize });
                bytesFreed += stateSize;
                
                // Stop if we've freed enough memory
                if (bytesFreed >= requiredBytes && this.characterCache.size - toEvict.length < this.maxCachedCharacters) {
                    break;
                }
            }
        }
        
        // Evict characters
        for (const { characterId, stateSize } of toEvict) {
            // Save state before eviction if needed
            if (this.autoSaveEnabled) {
                this.saveCharacterState(characterId).catch(error => {
                    this.logWarning(`Failed to save state for ${characterId} during eviction`, error);
                });
            }
            
            // Remove from cache
            this.characterCache.delete(characterId);
            this.characterStates.delete(characterId);
            this.lastAccessTimes.delete(characterId);
            
            // Update memory usage
            this.memoryUsageBytes -= stateSize;
            
            this.stats.evictions++;
        }
        
        // Update stats
        this.stats.cachedCharacters = this.characterCache.size;
        
        if (toEvict.length > 0) {
            this.logInfo(`Evicted ${toEvict.length} characters, freed ${bytesFreed} bytes`);
        }
        
        // Check if we're still over memory limit
        if (this.memoryUsageBytes > this.memoryThresholdMB * 1024 * 1024) {
            this.stats.memoryPressureEvents++;
            this.fireEvent('memory-pressure', {
                currentMemoryMB: this.memoryUsageBytes / (1024 * 1024),
                thresholdMB: this.memoryThresholdMB,
                cachedCharacters: this.characterCache.size
            });
            
            // Fire global event
            window.dispatchEvent(new CustomEvent('threadshift_memory_pressure', {
                detail: {
                    currentMemoryMB: this.memoryUsageBytes / (1024 * 1024),
                    thresholdMB: this.memoryThresholdMB
                }
            }));
        }
    }
    
    calculateStateSize(state) {
        // Rough estimate of state size in bytes
        const stateStr = JSON.stringify(state);
        return stateStr.length * 2; // UTF-16 approximation
    }
    
    // === BACKGROUND CLEANUP ===
    
    startBackgroundCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveCharacters();
        }, 60000); // Run every minute
    }
    
    cleanupInactiveCharacters() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        
        const toCleanup = [];
        
        for (const [characterId, lastAccess] of this.lastAccessTimes.entries()) {
            if (characterId !== this.activeCharacterId && now - lastAccess > maxAge) {
                toCleanup.push(characterId);
            }
        }
        
        if (toCleanup.length > 0) {
            this.logInfo(`Cleaning up ${toCleanup.length} inactive characters`);
            
            for (const characterId of toCleanup) {
                // Save state before cleanup
                if (this.autoSaveEnabled) {
                    this.saveCharacterState(characterId).catch(error => {
                        this.logWarning(`Failed to save state for ${characterId} during cleanup`, error);
                    });
                }
                
                // Remove from cache
                const state = this.characterCache.get(characterId);
                if (state) {
                    this.memoryUsageBytes -= this.calculateStateSize(state);
                }
                
                this.characterCache.delete(characterId);
                this.characterStates.delete(characterId);
                this.lastAccessTimes.delete(characterId);
            }
            
            this.stats.cachedCharacters = this.characterCache.size;
        }
    }
    
    // === UTILITY METHODS ===
    
    getSafeDefaultCharacter() {
        return this.defaultCharacterId;
    }
    
    createDefaultCharacterState() {
        return {
            currentBody: this.defaultCharacterId,
            originalBody: this.defaultCharacterId,
            bodyMap: {},
            inventory: [],
            dialog: {},
            tone: 'supportive',
            lastSwap: null,
            transformationState: {},
            npcMetadata: {},
            isNPC: false,
            displayName: this.defaultCharacterId,
            created: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
    }
    
    async initializeCharacterCache() {
        // Load metadata from storage if available
        const characterData = await this.storage.loadFromStorage('character_metadata', {});
        
        for (const [characterId, metadata] of Object.entries(characterData)) {
            this.characterMetadata.set(characterId, metadata);
            this.stats.totalCharacters++;
        }
    }
    
    async loadCharacterMetadata() {
        // This could be expanded to load additional metadata
        // For now, we'll populate it as characters are accessed
    }
    
    async ensureDefaultCharacter() {
        if (!await this.characterExists(this.defaultCharacterId)) {
            await this.createCharacter(this.defaultCharacterId);
            this.logInfo(`Created default character: ${this.defaultCharacterId}`);
        }
        
        // Set as active if no active character
        if (!this.activeCharacterId) {
            await this.switchCharacter(this.defaultCharacterId);
        }
    }
    
    setupEventListeners() {
        // Listen for session events
        this.addEventListener('session-started', () => {
            this.logInfo('Session started, ensuring default character');
            this.ensureDefaultCharacter();
        });
        
        this.addEventListener('session-ended', () => {
            this.logInfo('Session ended, saving all states');
            this.saveAllPendingStates();
        });
    }
    
    // === PUBLIC API ===
    
    getCharacterList() {
        return Array.from(this.characterMetadata.values());
    }
    
    getCachedCharacterList() {
        return Array.from(this.characterCache.keys());
    }
    
    getStats() {
        return {
            ...this.stats,
            memoryUsageMB: this.memoryUsageBytes / (1024 * 1024),
            activeCharacter: this.activeCharacterId,
            cacheSize: this.characterCache.size
        };
    }
    
    async updateCharacterMetadata(characterId, metadata) {
        if (!characterId) {
            throw new Error('Character ID is required');
        }
        
        const currentMetadata = this.characterMetadata.get(characterId) || {};
        const updatedMetadata = { ...currentMetadata, ...metadata };
        
        this.characterMetadata.set(characterId, updatedMetadata);
        
        // Save to storage
        const allMetadata = {};
        for (const [id, data] of this.characterMetadata.entries()) {
            allMetadata[id] = data;
        }
        await this.storage.saveToStorage('character_metadata', allMetadata);
        
        this.fireEvent('character-metadata-updated', {
            characterId,
            metadata: updatedMetadata
        });
        
        return updatedMetadata;
    }
    
    // === ERROR HANDLING ===
    
    handleError(context, error, isCritical = false) {
        super.handleError(context, error, isCritical);
        
        if (isCritical) {
            // Fire global event for critical errors
            window.dispatchEvent(new CustomEvent('threadshift_character_load_failed', {
                detail: {
                    context,
                    error: error.message,
                    characterId: this.activeCharacterId
                }
            }));
        }
    }
}

// Export for global access
window.ThreadshiftMultiCharacterHandler = ThreadshiftMultiCharacterHandler;

// Export for module loading
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftMultiCharacterHandler;
}