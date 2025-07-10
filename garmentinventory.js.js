/**
 * Threadshift Garment Inventory System
 * Handles garment storage, ownership tracking, worn state tracking, and swap management
 * Integrates with ThreadshiftModule base class and follows contract schema
 */

class ThreadshiftGarmentInventory extends ThreadshiftModule {
    constructor() {
        super('GarmentInventory');
        this.dependencies = ['storage', 'config'];
        
        // Core inventory storage - garments stored by ID
        this.inventory = new Map();
        
        // Tracking maps for worn state and ownership
        this.wornGarments = new Map();     // userId -> Set of worn garment IDs
        this.garmentWornBy = new Map();    // garmentId -> userId (currently wearing)
        this.lastWornBy = new Map();       // garmentId -> userId (last worn by)
        
        // Zone indexing for fast lookups
        this.zoneIndex = new Map();        // zone -> Set of garment IDs affecting that zone
        this.ownerIndex = new Map();       // userId -> Set of garment IDs owned
        
        // Performance optimization
        this.cache = new Map();
        this.cacheMaxSize = 100;
        this.cacheStats = { hits: 0, misses: 0 };
        
        // Validation rules
        this.validationRules = {
            maxGarmentsPerOwner: 1000,
            maxDescriptionLength: 500,
            requiredZones: ['hair', 'face', 'neck', 'chest', 'waist', 'hips', 'genitals', 'hands', 'legs', 'feet'],
            garmentIdPattern: /^\d{4}\.\d{4}$/,
            characterIdPattern: /^char\d{4}$/
        };
        
        // Event tracking
        this.eventHistory = [];
        this.maxEventHistory = 100;
    }

    async initialize() {
        if (!await super.initialize()) return false;
        
        try {
            // Load existing inventory from storage
            await this.loadInventoryFromStorage();
            
            // Rebuild indexes
            this.rebuildIndexes();
            
            // Setup cleanup tasks
            this.setupCleanupTasks();
            
            // Register event listeners
            this.setupEventListeners();
            
            console.log(`✓ ${this.moduleName} initialized with ${this.inventory.size} garments`);
            return true;
            
        } catch (error) {
            this.handleError('initialization', error, true);
            return false;
        }
    }

    /**
     * Load inventory from storage
     */
    async loadInventoryFromStorage() {
        const storageData = await this.dependencies.storage.loadFromStorage('garments', {
            inventory: {},
            wornState: {
                garmentWornBy: {},
                lastWornBy: {},
                wornGarments: {}
            }
        });
        
        // Load inventory
        for (const [garmentId, garmentData] of Object.entries(storageData.inventory)) {
            this.inventory.set(garmentId, this.validateGarmentData(garmentData));
        }
        
        // Load worn state
        if (storageData.wornState) {
            const { garmentWornBy, lastWornBy, wornGarments } = storageData.wornState;
            
            for (const [garmentId, userId] of Object.entries(garmentWornBy)) {
                this.garmentWornBy.set(garmentId, userId);
            }
            
            for (const [garmentId, userId] of Object.entries(lastWornBy)) {
                this.lastWornBy.set(garmentId, userId);
            }
            
            for (const [userId, garmentArray] of Object.entries(wornGarments)) {
                this.wornGarments.set(userId, new Set(garmentArray));
            }
        }
    }

    /**
     * Save inventory to storage
     */
    async saveInventoryToStorage() {
        const storageData = {
            inventory: Object.fromEntries(this.inventory),
            wornState: {
                garmentWornBy: Object.fromEntries(this.garmentWornBy),
                lastWornBy: Object.fromEntries(this.lastWornBy),
                wornGarments: Object.fromEntries(
                    Array.from(this.wornGarments.entries()).map(([userId, garmentSet]) => [
                        userId, 
                        Array.from(garmentSet)
                    ])
                )
            }
        };
        
        return await this.dependencies.storage.saveToStorage('garments', storageData);
    }

    /**
     * Validate garment data according to contract schema
     */
    validateGarmentData(garmentData) {
        const required = ['id', 'zones', 'owner', 'originOwner', 'description'];
        const optional = ['lastHolder', 'lastWornBy', 'createdAt', 'lastModified'];
        
        // Check required fields
        for (const field of required) {
            if (!garmentData.hasOwnProperty(field)) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Validate ID format
        if (!this.validationRules.garmentIdPattern.test(garmentData.id)) {
            throw new Error(`Invalid garment ID format: ${garmentData.id}. Must be XXXX.XXXX`);
        }
        
        // Validate character ID formats
        if (!this.validationRules.characterIdPattern.test(garmentData.owner)) {
            throw new Error(`Invalid owner ID format: ${garmentData.owner}. Must be charXXXX`);
        }
        
        if (!this.validationRules.characterIdPattern.test(garmentData.originOwner)) {
            throw new Error(`Invalid originOwner ID format: ${garmentData.originOwner}. Must be charXXXX`);
        }
        
        // Validate zones
        if (!Array.isArray(garmentData.zones) || garmentData.zones.length === 0) {
            throw new Error('Zones must be a non-empty array');
        }
        
        for (const zone of garmentData.zones) {
            if (!this.validationRules.requiredZones.includes(zone)) {
                throw new Error(`Invalid zone: ${zone}. Must be one of: ${this.validationRules.requiredZones.join(', ')}`);
            }
        }
        
        // Validate description length
        if (garmentData.description.length > this.validationRules.maxDescriptionLength) {
            throw new Error(`Description too long: ${garmentData.description.length} chars. Max: ${this.validationRules.maxDescriptionLength}`);
        }
        
        // Add timestamps if missing
        const now = new Date().toISOString();
        if (!garmentData.createdAt) {
            garmentData.createdAt = now;
        }
        if (!garmentData.lastModified) {
            garmentData.lastModified = now;
        }
        
        return garmentData;
    }

    /**
     * Create a new garment
     */
    async createGarment(garmentData) {
        if (!this.isReady()) {
            throw new Error('GarmentInventory not ready');
        }
        
        const validatedData = this.validateGarmentData(garmentData);
        
        // Check if garment already exists
        if (this.inventory.has(validatedData.id)) {
            throw new Error(`Garment ${validatedData.id} already exists`);
        }
        
        // Check owner garment limit
        const ownerGarments = this.getGarmentsByOwner(validatedData.owner);
        if (ownerGarments.length >= this.validationRules.maxGarmentsPerOwner) {
            throw new Error(`Owner ${validatedData.owner} has reached maximum garment limit`);
        }
        
        // Add to inventory
        this.inventory.set(validatedData.id, validatedData);
        
        // Update indexes
        this.updateIndexesForGarment(validatedData.id, validatedData);
        
        // Save to storage
        await this.saveInventoryToStorage();
        
        // Fire event
        this.fireEvent('garment_created', { garment: validatedData });
        
        // Track event
        this.trackEvent('create', validatedData.id, validatedData.owner);
        
        return validatedData;
    }

    /**
     * Get garment by ID
     */
    getGarment(garmentId) {
        if (!this.inventory.has(garmentId)) {
            return null;
        }
        
        // Check cache first
        const cacheKey = `garment_${garmentId}`;
        if (this.cache.has(cacheKey)) {
            this.cacheStats.hits++;
            return this.cache.get(cacheKey);
        }
        
        const garment = this.inventory.get(garmentId);
        
        // Add to cache
        this.addToCache(cacheKey, garment);
        this.cacheStats.misses++;
        
        return garment;
    }

    /**
     * Update garment data
     */
    async updateGarment(garmentId, updates) {
        if (!this.inventory.has(garmentId)) {
            throw new Error(`Garment ${garmentId} not found`);
        }
        
        const currentGarment = this.inventory.get(garmentId);
        const updatedGarment = {
            ...currentGarment,
            ...updates,
            lastModified: new Date().toISOString()
        };
        
        // Validate updated data
        const validatedData = this.validateGarmentData(updatedGarment);
        
        // Update inventory
        this.inventory.set(garmentId, validatedData);
        
        // Update indexes if zones or owner changed
        if (updates.zones || updates.owner) {
            this.removeFromIndexes(garmentId, currentGarment);
            this.updateIndexesForGarment(garmentId, validatedData);
        }
        
        // Clear cache
        this.cache.delete(`garment_${garmentId}`);
        
        // Save to storage
        await this.saveInventoryToStorage();
        
        // Fire event
        this.fireEvent('garment_updated', { 
            garmentId, 
            oldData: currentGarment, 
            newData: validatedData 
        });
        
        return validatedData;
    }

    /**
     * Delete garment
     */
    async deleteGarment(garmentId) {
        if (!this.inventory.has(garmentId)) {
            throw new Error(`Garment ${garmentId} not found`);
        }
        
        const garment = this.inventory.get(garmentId);
        
        // Remove from worn state
        this.removeFromWornState(garmentId);
        
        // Remove from indexes
        this.removeFromIndexes(garmentId, garment);
        
        // Remove from inventory
        this.inventory.delete(garmentId);
        
        // Clear cache
        this.cache.delete(`garment_${garmentId}`);
        
        // Save to storage
        await this.saveInventoryToStorage();
        
        // Fire event
        this.fireEvent('garment_deleted', { garmentId, garment });
        
        // Track event
        this.trackEvent('delete', garmentId, garment.owner);
        
        return true;
    }

    /**
     * Get garments by owner
     */
    getGarmentsByOwner(ownerId) {
        const garmentIds = this.ownerIndex.get(ownerId) || new Set();
        return Array.from(garmentIds).map(id => this.getGarment(id)).filter(Boolean);
    }

    /**
     * Get garments by zone
     */
    getGarmentsByZone(zone) {
        if (!this.validationRules.requiredZones.includes(zone)) {
            throw new Error(`Invalid zone: ${zone}`);
        }
        
        const garmentIds = this.zoneIndex.get(zone) || new Set();
        return Array.from(garmentIds).map(id => this.getGarment(id)).filter(Boolean);
    }

    /**
     * Get garments worn by user
     */
    getWornGarments(userId) {
        const wornGarmentIds = this.wornGarments.get(userId) || new Set();
        return Array.from(wornGarmentIds).map(id => this.getGarment(id)).filter(Boolean);
    }

    /**
     * Update worn state
     */
    async updateWornState(garmentId, userId, action = 'wear') {
        if (!this.inventory.has(garmentId)) {
            throw new Error(`Garment ${garmentId} not found`);
        }
        
        const garment = this.inventory.get(garmentId);
        
        if (action === 'wear') {
            // Remove from current wearer if any
            const currentWearer = this.garmentWornBy.get(garmentId);
            if (currentWearer && currentWearer !== userId) {
                this.removeFromWornState(garmentId);
            }
            
            // Add to new wearer
            this.garmentWornBy.set(garmentId, userId);
            this.lastWornBy.set(garmentId, userId);
            
            if (!this.wornGarments.has(userId)) {
                this.wornGarments.set(userId, new Set());
            }
            this.wornGarments.get(userId).add(garmentId);
            
            // Update garment lastWornBy
            await this.updateGarment(garmentId, { lastWornBy: userId });
            
            this.fireEvent('garment_worn', { garmentId, userId, garment });
            
        } else if (action === 'unwear') {
            this.removeFromWornState(garmentId);
            this.fireEvent('garment_unworn', { garmentId, userId, garment });
        }
        
        // Save worn state
        await this.saveInventoryToStorage();
    }

    /**
     * Transfer ownership
     */
    async transferOwnership(garmentId, newOwnerId) {
        if (!this.inventory.has(garmentId)) {
            throw new Error(`Garment ${garmentId} not found`);
        }
        
        if (!this.validationRules.characterIdPattern.test(newOwnerId)) {
            throw new Error(`Invalid new owner ID: ${newOwnerId}`);
        }
        
        const garment = this.inventory.get(garmentId);
        const oldOwnerId = garment.owner;
        
        // Update garment
        await this.updateGarment(garmentId, { 
            owner: newOwnerId,
            lastHolder: oldOwnerId
        });
        
        this.fireEvent('ownership_transferred', { 
            garmentId, 
            oldOwnerId, 
            newOwnerId,
            garment 
        });
        
        // Track event
        this.trackEvent('transfer', garmentId, newOwnerId, { from: oldOwnerId });
        
        return true;
    }

    /**
     * Prepare garment for swap (returns swap data)
     */
    prepareGarmentForSwap(garmentId, targetUserId) {
        if (!this.inventory.has(garmentId)) {
            throw new Error(`Garment ${garmentId} not found`);
        }
        
        const garment = this.inventory.get(garmentId);
        const lastWornBy = this.lastWornBy.get(garmentId);
        
        if (!lastWornBy) {
            throw new Error(`Garment ${garmentId} has never been worn`);
        }
        
        return {
            garmentId,
            garment,
            sourceUserId: lastWornBy,
            targetUserId,
            zones: garment.zones,
            description: garment.description,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get inventory statistics
     */
    getInventoryStats() {
        const stats = {
            totalGarments: this.inventory.size,
            totalOwners: this.ownerIndex.size,
            totalWornGarments: this.garmentWornBy.size,
            totalActiveWearers: this.wornGarments.size,
            zoneDistribution: {},
            ownerDistribution: {},
            cacheStats: { ...this.cacheStats },
            eventHistory: this.eventHistory.length
        };
        
        // Zone distribution
        for (const [zone, garmentIds] of this.zoneIndex.entries()) {
            stats.zoneDistribution[zone] = garmentIds.size;
        }
        
        // Owner distribution
        for (const [ownerId, garmentIds] of this.ownerIndex.entries()) {
            stats.ownerDistribution[ownerId] = garmentIds.size;
        }
        
        return stats;
    }

    /**
     * Export inventory data
     */
    exportInventory() {
        return {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            inventory: Object.fromEntries(this.inventory),
            wornState: {
                garmentWornBy: Object.fromEntries(this.garmentWornBy),
                lastWornBy: Object.fromEntries(this.lastWornBy),
                wornGarments: Object.fromEntries(
                    Array.from(this.wornGarments.entries()).map(([userId, garmentSet]) => [
                        userId, 
                        Array.from(garmentSet)
                    ])
                )
            },
            eventHistory: this.eventHistory.slice(-50) // Last 50 events
        };
    }

    /**
     * Import inventory data
     */
    async importInventory(data, merge = false) {
        if (!data || !data.inventory) {
            throw new Error('Invalid import data');
        }
        
        if (!merge) {
            this.inventory.clear();
            this.clearIndexes();
            this.clearWornState();
        }
        
        // Import garments
        for (const [garmentId, garmentData] of Object.entries(data.inventory)) {
            try {
                const validatedData = this.validateGarmentData(garmentData);
                this.inventory.set(garmentId, validatedData);
                this.updateIndexesForGarment(garmentId, validatedData);
            } catch (error) {
                console.warn(`Failed to import garment ${garmentId}:`, error.message);
            }
        }
        
        // Import worn state
        if (data.wornState) {
            const { garmentWornBy, lastWornBy, wornGarments } = data.wornState;
            
            for (const [garmentId, userId] of Object.entries(garmentWornBy || {})) {
                this.garmentWornBy.set(garmentId, userId);
            }
            
            for (const [garmentId, userId] of Object.entries(lastWornBy || {})) {
                this.lastWornBy.set(garmentId, userId);
            }
            
            for (const [userId, garmentArray] of Object.entries(wornGarments || {})) {
                this.wornGarments.set(userId, new Set(garmentArray));
            }
        }
        
        // Save to storage
        await this.saveInventoryToStorage();
        
        this.fireEvent('inventory_imported', { 
            garmentCount: this.inventory.size,
            merge 
        });
        
        return true;
    }

    // Helper methods for internal management

    updateIndexesForGarment(garmentId, garment) {
        // Update zone index
        for (const zone of garment.zones) {
            if (!this.zoneIndex.has(zone)) {
                this.zoneIndex.set(zone, new Set());
            }
            this.zoneIndex.get(zone).add(garmentId);
        }
        
        // Update owner index
        if (!this.ownerIndex.has(garment.owner)) {
            this.ownerIndex.set(garment.owner, new Set());
        }
        this.ownerIndex.get(garment.owner).add(garmentId);
    }

    removeFromIndexes(garmentId, garment) {
        // Remove from zone index
        for (const zone of garment.zones) {
            const zoneSet = this.zoneIndex.get(zone);
            if (zoneSet) {
                zoneSet.delete(garmentId);
                if (zoneSet.size === 0) {
                    this.zoneIndex.delete(zone);
                }
            }
        }
        
        // Remove from owner index
        const ownerSet = this.ownerIndex.get(garment.owner);
        if (ownerSet) {
            ownerSet.delete(garmentId);
            if (ownerSet.size === 0) {
                this.ownerIndex.delete(garment.owner);
            }
        }
    }

    removeFromWornState(garmentId) {
        const currentWearer = this.garmentWornBy.get(garmentId);
        if (currentWearer) {
            const userWornGarments = this.wornGarments.get(currentWearer);
            if (userWornGarments) {
                userWornGarments.delete(garmentId);
                if (userWornGarments.size === 0) {
                    this.wornGarments.delete(currentWearer);
                }
            }
            this.garmentWornBy.delete(garmentId);
        }
    }

    rebuildIndexes() {
        this.clearIndexes();
        
        for (const [garmentId, garment] of this.inventory.entries()) {
            this.updateIndexesForGarment(garmentId, garment);
        }
    }

    clearIndexes() {
        this.zoneIndex.clear();
        this.ownerIndex.clear();
    }

    clearWornState() {
        this.wornGarments.clear();
        this.garmentWornBy.clear();
        this.lastWornBy.clear();
    }

    addToCache(key, value) {
        if (this.cache.size >= this.cacheMaxSize) {
            // Remove oldest entry
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    trackEvent(action, garmentId, userId, metadata = {}) {
        const event = {
            action,
            garmentId,
            userId,
            metadata,
            timestamp: new Date().toISOString()
        };
        
        this.eventHistory.push(event);
        
        // Limit history size
        if (this.eventHistory.length > this.maxEventHistory) {
            this.eventHistory.shift();
        }
    }

    setupCleanupTasks() {
        // Cache cleanup
        this.cleanupTasks.push(() => {
            this.cache.clear();
            this.cacheStats = { hits: 0, misses: 0 };
        });
        
        // Event history cleanup
        this.cleanupTasks.push(() => {
            this.eventHistory = [];
        });
    }

    setupEventListeners() {
        // Listen for storage events
        this.addEventListener('storage_cleared', () => {
            this.inventory.clear();
            this.clearIndexes();
            this.clearWornState();
            this.cache.clear();
        });
    }

    async shutdown() {
        // Save final state
        await this.saveInventoryToStorage();
        
        // Clear caches
        this.cache.clear();
        this.eventHistory = [];
        
        await super.shutdown();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftGarmentInventory;
}

// Browser global
if (typeof window !== 'undefined') {
    window.ThreadshiftGarmentInventory = ThreadshiftGarmentInventory;
}