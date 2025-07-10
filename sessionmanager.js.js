/**
 * Threadshift Session Manager
 * Handles session state persistence, active character tracking, and chat context management
 * Part of the foundation layer in the Threadshift architecture
 */

class ThreadshiftSessionManager extends ThreadshiftModule {
    constructor() {
        super('SessionManager');
        this.dependencies = ['storage', 'config'];
        
        // Session state
        this.sessionId = null;
        this.chatId = null;
        this.activeCharacters = new Set();
        this.characterStates = new Map();
        this.sessionData = {
            startTime: null,
            lastActivity: null,
            transformationCount: 0,
            activeSwaps: new Map(),
            chatHistory: [],
            settings: {}
        };
        
        // Session configuration
        this.config = {
            autoSave: true,
            autoSaveInterval: 30000, // 30 seconds
            maxHistoryEntries: 100,
            sessionTimeout: 3600000, // 1 hour
            persistAcrossSessions: true,
            trackChatHistory: true,
            enableAutoDetection: true
        };
        
        // State tracking
        this.isActive = false;
        this.autoSaveTimer = null;
        this.lastSaveTime = null;
        this.pendingChanges = false;
        
        // ST integration
        this.stEventListeners = new Map();
        this.chatObserver = null;
        this.characterObserver = null;
        
        // Performance tracking
        this.stats = {
            sessionsCreated: 0,
            charactersTracked: 0,
            transformationsApplied: 0,
            autoSaves: 0,
            lastPerformanceCheck: Date.now()
        };
    }
    
    async initialize() {
        if (!await super.initialize()) {
            return false;
        }
        
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize session
            await this.initializeSession();
            
            // Set up ST integration
            this.setupSTIntegration();
            
            // Start auto-save if enabled
            if (this.config.autoSave) {
                this.startAutoSave();
            }
            
            // Set up event listeners
            this.setupEventListeners();
            
            console.log('✓ ThreadshiftSessionManager initialized');
            this.fireEvent('session-manager-initialized');
            
            return true;
        } catch (error) {
            this.handleError('initialize', error, true);
            return false;
        }
    }
    
    async shutdown() {
        try {
            // Save current session
            await this.saveSession();
            
            // Stop auto-save
            this.stopAutoSave();
            
            // Clean up ST integration
            this.cleanupSTIntegration();
            
            // Clear state
            this.clearSessionState();
            
            await super.shutdown();
            console.log('✓ ThreadshiftSessionManager shutdown');
        } catch (error) {
            this.handleError('shutdown', error, false);
        }
    }
    
    // === SESSION MANAGEMENT ===
    
    async initializeSession() {
        // Generate session ID
        this.sessionId = this.generateSessionId();
        
        // Load existing session if configured
        if (this.config.persistAcrossSessions) {
            await this.loadPreviousSession();
        }
        
        // Set up new session data
        this.sessionData = {
            ...this.sessionData,
            sessionId: this.sessionId,
            startTime: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            version: '1.0.0'
        };
        
        // Detect current chat context
        if (this.config.enableAutoDetection) {
            await this.detectChatContext();
        }
        
        this.isActive = true;
        this.stats.sessionsCreated++;
        
        this.fireEvent('session-initialized', {
            sessionId: this.sessionId,
            chatId: this.chatId,
            activeCharacters: Array.from(this.activeCharacters)
        });
    }
    
    async loadPreviousSession() {
        try {
            const savedSession = await this.loadFromStorage('session', null);
            if (savedSession && this.isValidSession(savedSession)) {
                // Restore previous session data
                this.sessionData = {
                    ...this.sessionData,
                    ...savedSession,
                    startTime: new Date().toISOString(), // New session start time
                    lastActivity: new Date().toISOString()
                };
                
                // Restore active characters
                if (savedSession.activeCharacters) {
                    this.activeCharacters = new Set(savedSession.activeCharacters);
                }
                
                // Restore character states
                if (savedSession.characterStates) {
                    this.characterStates = new Map(Object.entries(savedSession.characterStates));
                }
                
                // Restore active swaps
                if (savedSession.activeSwaps) {
                    this.sessionData.activeSwaps = new Map(Object.entries(savedSession.activeSwaps));
                }
                
                console.log('Previous session restored:', savedSession.sessionId);
                return true;
            }
        } catch (error) {
            this.handleError('loadPreviousSession', error, false);
        }
        return false;
    }
    
    async saveSession() {
        try {
            const sessionToSave = {
                ...this.sessionData,
                activeCharacters: Array.from(this.activeCharacters),
                characterStates: Object.fromEntries(this.characterStates),
                activeSwaps: Object.fromEntries(this.sessionData.activeSwaps),
                lastSaved: new Date().toISOString()
            };
            
            await this.saveToStorage('session', sessionToSave);
            this.lastSaveTime = Date.now();
            this.pendingChanges = false;
            this.stats.autoSaves++;
            
            this.fireEvent('session-saved', { sessionId: this.sessionId });
            return true;
        } catch (error) {
            this.handleError('saveSession', error, false);
            return false;
        }
    }
    
    // === CHARACTER MANAGEMENT ===
    
    async addCharacter(characterId, characterData = {}) {
        if (!characterId || typeof characterId !== 'string') {
            throw new Error('Invalid character ID');
        }
        
        if (this.activeCharacters.has(characterId)) {
            return false; // Already active
        }
        
        this.activeCharacters.add(characterId);
        this.characterStates.set(characterId, {
            id: characterId,
            addedAt: new Date().toISOString(),
            transformations: [],
            currentState: 'active',
            ...characterData
        });
        
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        this.stats.charactersTracked++;
        
        this.fireEvent('character-added', { characterId, sessionId: this.sessionId });
        
        if (this.config.autoSave) {
            await this.saveSession();
        }
        
        return true;
    }
    
    async removeCharacter(characterId) {
        if (!this.activeCharacters.has(characterId)) {
            return false;
        }
        
        this.activeCharacters.delete(characterId);
        this.characterStates.delete(characterId);
        
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        
        this.fireEvent('character-removed', { characterId, sessionId: this.sessionId });
        
        if (this.config.autoSave) {
            await this.saveSession();
        }
        
        return true;
    }
    
    getCharacterState(characterId) {
        return this.characterStates.get(characterId) || null;
    }
    
    updateCharacterState(characterId, stateUpdate) {
        const currentState = this.characterStates.get(characterId);
        if (!currentState) {
            throw new Error(`Character ${characterId} not found in session`);
        }
        
        const updatedState = {
            ...currentState,
            ...stateUpdate,
            lastModified: new Date().toISOString()
        };
        
        this.characterStates.set(characterId, updatedState);
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        
        this.fireEvent('character-state-updated', { characterId, state: updatedState });
        
        return updatedState;
    }
    
    // === TRANSFORMATION TRACKING ===
    
    recordTransformation(transformationData) {
        const transformation = {
            id: this.generateTransformationId(),
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            ...transformationData
        };
        
        // Add to session history
        this.sessionData.chatHistory.push(transformation);
        
        // Update character states
        if (transformation.sourceCharId) {
            this.updateCharacterTransformationHistory(transformation.sourceCharId, transformation);
        }
        if (transformation.targetCharId) {
            this.updateCharacterTransformationHistory(transformation.targetCharId, transformation);
        }
        
        this.sessionData.transformationCount++;
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        this.stats.transformationsApplied++;
        
        this.fireEvent('transformation-recorded', transformation);
        
        // Limit history size
        if (this.sessionData.chatHistory.length > this.config.maxHistoryEntries) {
            this.sessionData.chatHistory = this.sessionData.chatHistory.slice(-this.config.maxHistoryEntries);
        }
        
        return transformation;
    }
    
    updateCharacterTransformationHistory(characterId, transformation) {
        const characterState = this.characterStates.get(characterId);
        if (characterState) {
            if (!characterState.transformations) {
                characterState.transformations = [];
            }
            characterState.transformations.push(transformation);
            
            // Limit per-character history
            if (characterState.transformations.length > 20) {
                characterState.transformations = characterState.transformations.slice(-20);
            }
        }
    }
    
    // === ACTIVE SWAP MANAGEMENT ===
    
    addActiveSwap(swapId, swapData) {
        this.sessionData.activeSwaps.set(swapId, {
            ...swapData,
            sessionId: this.sessionId,
            addedAt: new Date().toISOString()
        });
        
        this.pendingChanges = true;
        this.fireEvent('active-swap-added', { swapId, swapData });
    }
    
    removeActiveSwap(swapId) {
        const removed = this.sessionData.activeSwaps.delete(swapId);
        if (removed) {
            this.pendingChanges = true;
            this.fireEvent('active-swap-removed', { swapId });
        }
        return removed;
    }
    
    getActiveSwaps() {
        return Array.from(this.sessionData.activeSwaps.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
    }
    
    // === SILLYTAVERN INTEGRATION ===
    
    setupSTIntegration() {
        // Monitor chat changes
        this.setupChatObserver();
        
        // Monitor character changes
        this.setupCharacterObserver();
        
        // Listen to ST events
        this.setupSTEventListeners();
    }
    
    setupChatObserver() {
        if (typeof window.MutationObserver !== 'undefined') {
            this.chatObserver = new MutationObserver((mutations) => {
                this.handleChatChanges(mutations);
            });
            
            // Observe chat container if available
            const chatContainer = document.querySelector('#chat');
            if (chatContainer) {
                this.chatObserver.observe(chatContainer, {
                    childList: true,
                    subtree: true
                });
            }
        }
    }
    
    setupCharacterObserver() {
        // Monitor character selection changes
        if (typeof window.addEventListener === 'function') {
            const characterChangeHandler = () => {
                this.handleCharacterChange();
            };
            
            window.addEventListener('character_changed', characterChangeHandler);
            this.stEventListeners.set('character_changed', characterChangeHandler);
        }
    }
    
    setupSTEventListeners() {
        // Listen for ST-specific events
        const events = [
            'chat_changed',
            'character_selected',
            'group_updated',
            'message_sent',
            'message_received'
        ];
        
        events.forEach(eventName => {
            const handler = (event) => {
                this.handleSTEvent(eventName, event);
            };
            
            if (typeof window.addEventListener === 'function') {
                window.addEventListener(eventName, handler);
                this.stEventListeners.set(eventName, handler);
            }
        });
    }
    
    async detectChatContext() {
        try {
            // Detect current chat ID
            this.chatId = this.getCurrentChatId();
            
            // Detect active characters
            const activeChars = this.getActiveCharactersFromST();
            
            // Add detected characters to session
            for (const charId of activeChars) {
                await this.addCharacter(charId, {
                    source: 'auto-detected',
                    chatId: this.chatId
                });
            }
            
            this.fireEvent('chat-context-detected', {
                chatId: this.chatId,
                characters: activeChars
            });
            
        } catch (error) {
            this.handleError('detectChatContext', error, false);
        }
    }
    
    getCurrentChatId() {
        // Try to get chat ID from ST context
        if (typeof window.getCurrentChatId === 'function') {
            return window.getCurrentChatId();
        }
        
        // Fallback: generate from current context
        return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    getActiveCharactersFromST() {
        const characters = [];
        
        try {
            // Get main character
            if (window.this_chid !== undefined && window.characters && window.characters[window.this_chid]) {
                characters.push(window.characters[window.this_chid].avatar);
            }
            
            // Get group characters
            if (window.selected_group && window.groups && window.groups[window.selected_group]) {
                const group = window.groups[window.selected_group];
                if (group.members) {
                    characters.push(...group.members);
                }
            }
        } catch (error) {
            this.handleError('getActiveCharactersFromST', error, false);
        }
        
        return [...new Set(characters)]; // Remove duplicates
    }
    
    // === EVENT HANDLERS ===
    
    handleChatChanges(mutations) {
        // Update session activity
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        
        // Process mutations for relevant changes
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                // New messages or chat changes
                this.fireEvent('chat-activity-detected', {
                    sessionId: this.sessionId,
                    timestamp: new Date().toISOString()
                });
            }
        });
    }
    
    async handleCharacterChange() {
        // Re-detect active characters
        await this.detectChatContext();
        
        this.fireEvent('character-context-changed', {
            sessionId: this.sessionId,
            activeCharacters: Array.from(this.activeCharacters)
        });
    }
    
    handleSTEvent(eventName, event) {
        this.sessionData.lastActivity = new Date().toISOString();
        this.pendingChanges = true;
        
        this.fireEvent('st-event-received', {
            eventName,
            event,
            sessionId: this.sessionId
        });
    }
    
    // === AUTO-SAVE MANAGEMENT ===
    
    startAutoSave() {
        if (this.autoSaveTimer) {
            this.stopAutoSave();
        }
        
        this.autoSaveTimer = setInterval(async () => {
            if (this.pendingChanges && this.isActive) {
                await this.saveSession();
            }
        }, this.config.autoSaveInterval);
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    
    // === UTILITY METHODS ===
    
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateTransformationId() {
        return `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    isValidSession(sessionData) {
        return sessionData &&
               typeof sessionData === 'object' &&
               sessionData.sessionId &&
               sessionData.startTime;
    }
    
    getSessionStats() {
        return {
            sessionId: this.sessionId,
            chatId: this.chatId,
            isActive: this.isActive,
            activeCharacters: Array.from(this.activeCharacters),
            transformationCount: this.sessionData.transformationCount,
            activeSwaps: this.sessionData.activeSwaps.size,
            uptime: this.sessionData.startTime ? 
                Date.now() - new Date(this.sessionData.startTime).getTime() : 0,
            lastActivity: this.sessionData.lastActivity,
            stats: this.stats
        };
    }
    
    async loadConfiguration() {
        try {
            const savedConfig = await this.loadFromStorage('session_config', {});
            this.config = {
                ...this.config,
                ...savedConfig
            };
        } catch (error) {
            this.handleError('loadConfiguration', error, false);
        }
    }
    
    async updateConfiguration(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
        
        await this.saveToStorage('session_config', this.config);
        
        // Apply configuration changes
        if (newConfig.autoSave !== undefined) {
            if (newConfig.autoSave) {
                this.startAutoSave();
            } else {
                this.stopAutoSave();
            }
        }
        
        this.fireEvent('configuration-updated', { config: this.config });
    }
    
    cleanupSTIntegration() {
        // Remove event listeners
        this.stEventListeners.forEach((handler, eventName) => {
            if (typeof window.removeEventListener === 'function') {
                window.removeEventListener(eventName, handler);
            }
        });
        this.stEventListeners.clear();
        
        // Disconnect observers
        if (this.chatObserver) {
            this.chatObserver.disconnect();
            this.chatObserver = null;
        }
        
        if (this.characterObserver) {
            this.characterObserver.disconnect();
            this.characterObserver = null;
        }
    }
    
    clearSessionState() {
        this.isActive = false;
        this.activeCharacters.clear();
        this.characterStates.clear();
        this.sessionData.activeSwaps.clear();
        this.sessionData.chatHistory = [];
        this.pendingChanges = false;
    }
    
    // === STORAGE INTERFACE ===
    
    async saveToStorage(key, data) {
        // Interface with storage manager
        if (this.storage && typeof this.storage.saveToStorage === 'function') {
            return await this.storage.saveToStorage(key, data);
        }
        
        // Fallback to ST extension storage
        try {
            window.extensionSettings[`threadshift_${key}`] = data;
            if (typeof window.saveSettings === 'function') {
                await window.saveSettings();
            }
            return true;
        } catch (error) {
            this.handleError('saveToStorage', error, false);
            return false;
        }
    }
    
    async loadFromStorage(key, defaultValue = null) {
        // Interface with storage manager
        if (this.storage && typeof this.storage.loadFromStorage === 'function') {
            return await this.storage.loadFromStorage(key, defaultValue);
        }
        
        // Fallback to ST extension storage
        try {
            const data = window.extensionSettings[`threadshift_${key}`];
            return data !== undefined ? data : defaultValue;
        } catch (error) {
            this.handleError('loadFromStorage', error, false);
            return defaultValue;
        }
    }
    
    // === PUBLIC API ===
    
    getActiveCharacters() {
        return Array.from(this.activeCharacters);
    }
    
    getSessionData() {
        return {
            ...this.sessionData,
            activeCharacters: Array.from(this.activeCharacters),
            characterStates: Object.fromEntries(this.characterStates)
        };
    }
    
    isCharacterActive(characterId) {
        return this.activeCharacters.has(characterId);
    }
    
    getTransformationHistory(characterId = null) {
        if (characterId) {
            const characterState = this.characterStates.get(characterId);
            return characterState ? characterState.transformations || [] : [];
        }
        return this.sessionData.chatHistory;
    }
    
    async clearSession() {
        this.clearSessionState();
        await this.saveSession();
        this.fireEvent('session-cleared', { sessionId: this.sessionId });
    }
    
    async restartSession() {
        await this.clearSession();
        await this.initializeSession();
        this.fireEvent('session-restarted', { sessionId: this.sessionId });
    }
}