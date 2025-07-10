/**
 * ThreadshiftBodyMapValidator - Validates character body maps for structural completeness
 * Part of Threadshift Foundation Layer
 * 
 * Validates character body maps for structural completeness and correctness.
 * This module is called **before transformations** to ensure that maps are valid and usable by the core engine.
 */

class ThreadshiftBodyMapValidator extends ThreadshiftModule {
    constructor() {
        super('BodyMapValidator');
        
        // Add dependencies
        this.dependencies = ['config'];
        
        // Validation rules and constants
        this.validationRules = {
            requiredZones: [
                'hair', 'face', 'neck', 'chest', 'waist', 
                'butt', 'genitals', 'hands', 'legs', 'feet'
            ],
            invalidZones: [
                'torso', 'height', 'voice', 'head'
            ],
            muscleZones: [
                'chest', 'waist', 'legs', 'butt'
            ],
            validMarkTypes: [
                'tattoo', 'scar', 'freckles', 'mole', 'birthmark'
            ],
            validVisibilityLevels: [
                'high', 'medium', 'low'
            ],
            validGenitalTypes: [
                'vagina', 'penis', 'anal'
            ]
        };
        
        // Schema version for validation
        this.schemaVersion = '1.0.0';
        
        // Statistics
        this.validationStats = {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            errorsByType: {}
        };
    }
    
    /**
     * Initialize the validator
     */
    async initialize() {
        const success = await super.initialize();
        if (!success) return false;
        
        try {
            // Load any custom validation rules from config
            this.loadCustomValidationRules();
            
            // Setup validation caching if enabled
            if (this.getConfig('performance.enableValidationCache', true)) {
                this.setupValidationCache();
            }
            
            this.logInfo('BodyMapValidator initialized successfully');
            return true;
            
        } catch (error) {
            this.handleError('initialization', error, true);
            return false;
        }
    }
    
    /**
     * Load custom validation rules from configuration
     */
    loadCustomValidationRules() {
        const customRules = this.getConfig('validation.customRules');
        if (customRules) {
            // Merge custom rules with defaults
            Object.assign(this.validationRules, customRules);
            this.logInfo('Custom validation rules loaded');
        }
    }
    
    /**
     * Setup validation result caching
     */
    setupValidationCache() {
        this.validationCache = new Map();
        this.cacheMaxSize = this.getConfig('performance.validationCacheSize', 100);
        
        // Clear cache periodically
        this.addCleanupTask(() => {
            this.validationCache.clear();
        });
    }
    
    /**
     * Main validation method - validates a complete body map
     * @param {Object} bodyMap - The body map to validate
     * @param {Object} options - Validation options
     * @returns {Object} Validation result with success flag and errors
     */
    validateBodyMap(bodyMap, options = {}) {
        const startTime = performance.now();
        
        try {
            // Input validation
            if (!bodyMap || typeof bodyMap !== 'object') {
                return this.createValidationResult(false, ['Body map must be a valid object']);
            }
            
            // Check cache if enabled
            if (this.validationCache && !options.skipCache) {
                const cacheKey = this.generateCacheKey(bodyMap);
                const cached = this.validationCache.get(cacheKey);
                if (cached) {
                    this.logDebug('Validation result retrieved from cache');
                    return cached;
                }
            }
            
            const errors = [];
            
            // Validate basic structure
            this.validateBasicStructure(bodyMap, errors);
            
            // Validate required zones
            this.validateRequiredZones(bodyMap, errors);
            
            // Validate invalid zones (should not be present)
            this.validateInvalidZones(bodyMap, errors);
            
            // Validate each zone
            this.validateZones(bodyMap, errors);
            
            // Validate genital zone specifically
            if (bodyMap.genitals) {
                this.validateGenitalZone(bodyMap.genitals, errors);
            }
            
            // Create result
            const result = this.createValidationResult(errors.length === 0, errors);
            
            // Cache result if enabled
            if (this.validationCache && !options.skipCache) {
                this.cacheValidationResult(bodyMap, result);
            }
            
            // Update statistics
            this.updateValidationStats(result, startTime);
            
            return result;
            
        } catch (error) {
            this.handleError('validateBodyMap', error);
            return this.createValidationResult(false, [`Validation failed: ${error.message}`]);
        }
    }
    
    /**
     * Validate basic structure of body map
     */
    validateBasicStructure(bodyMap, errors) {
        // Check if it's an object
        if (typeof bodyMap !== 'object' || Array.isArray(bodyMap)) {
            errors.push('Body map must be a plain object');
            return;
        }
        
        // Check for completely empty body map
        if (Object.keys(bodyMap).length === 0) {
            errors.push('Body map cannot be empty');
            return;
        }
        
        // Validate schema version if present
        if (bodyMap._version && typeof bodyMap._version !== 'string') {
            errors.push('Body map version must be a string');
        }
    }
    
    /**
     * Validate that all required zones are present
     */
    validateRequiredZones(bodyMap, errors) {
        for (const zone of this.validationRules.requiredZones) {
            if (!bodyMap[zone]) {
                errors.push(`Missing required zone: ${zone}`);
            }
        }
    }
    
    /**
     * Validate that invalid zones are not present
     */
    validateInvalidZones(bodyMap, errors) {
        for (const zone of this.validationRules.invalidZones) {
            if (bodyMap[zone]) {
                errors.push(`Invalid zone present: ${zone} (should not be included)`);
            }
        }
    }
    
    /**
     * Validate all zones in the body map
     */
    validateZones(bodyMap, errors) {
        for (const [zoneName, zoneData] of Object.entries(bodyMap)) {
            // Skip metadata fields
            if (zoneName.startsWith('_')) continue;
            
            // Validate zone name
            if (!this.isValidZone(zoneName)) {
                errors.push(`Invalid zone name: ${zoneName}`);
                continue;
            }
            
            // Validate zone structure
            this.validateZoneStructure(zoneName, zoneData, errors);
        }
    }
    
    /**
     * Validate individual zone structure
     */
    validateZoneStructure(zoneName, zoneData, errors) {
        if (!zoneData || typeof zoneData !== 'object') {
            errors.push(`Zone '${zoneName}' must be an object`);
            return;
        }
        
        // Required fields for all zones
        const requiredFields = ['descriptor', 'care', 'marks', '_plugin'];
        
        for (const field of requiredFields) {
            if (!(field in zoneData)) {
                errors.push(`Zone '${zoneName}' missing required field: ${field}`);
            }
        }
        
        // Validate field types
        if (zoneData.descriptor && typeof zoneData.descriptor !== 'string') {
            errors.push(`Zone '${zoneName}' field 'descriptor' must be a string`);
        }
        
        if (zoneData.care && typeof zoneData.care !== 'string') {
            errors.push(`Zone '${zoneName}' field 'care' must be a string`);
        }
        
        // Validate marks array
        if (zoneData.marks) {
            this.validateMarksArray(zoneName, zoneData.marks, errors);
        }
        
        // Validate plugin data
        if (zoneData._plugin) {
            this.validatePluginData(zoneName, zoneData._plugin, errors);
        }
        
        // Validate tone field for muscle zones
        if (this.validationRules.muscleZones.includes(zoneName)) {
            if (!zoneData.tone) {
                errors.push(`Zone '${zoneName}' missing required field: tone`);
            } else if (typeof zoneData.tone !== 'string') {
                errors.push(`Zone '${zoneName}' field 'tone' must be a string`);
            }
        }
    }
    
    /**
     * Validate marks array
     */
    validateMarksArray(zoneName, marks, errors) {
        if (!Array.isArray(marks)) {
            errors.push(`Zone '${zoneName}' field 'marks' must be an array`);
            return;
        }
        
        for (let i = 0; i < marks.length; i++) {
            const mark = marks[i];
            const markPrefix = `Zone '${zoneName}' mark[${i}]`;
            
            if (!mark || typeof mark !== 'object') {
                errors.push(`${markPrefix} must be an object`);
                continue;
            }
            
            // Validate required mark fields
            if (!mark.type) {
                errors.push(`${markPrefix} missing required field: type`);
            } else if (!this.validationRules.validMarkTypes.includes(mark.type)) {
                errors.push(`${markPrefix} invalid type: ${mark.type}`);
            }
            
            if (!mark.description || typeof mark.description !== 'string') {
                errors.push(`${markPrefix} field 'description' must be a non-empty string`);
            }
            
            if (!mark.location_detail || typeof mark.location_detail !== 'string') {
                errors.push(`${markPrefix} field 'location_detail' must be a non-empty string`);
            }
            
            if (!mark.visibility) {
                errors.push(`${markPrefix} missing required field: visibility`);
            } else if (!this.validationRules.validVisibilityLevels.includes(mark.visibility)) {
                errors.push(`${markPrefix} invalid visibility: ${mark.visibility}`);
            }
        }
    }
    
    /**
     * Validate plugin data
     */
    validatePluginData(zoneName, pluginData, errors) {
        if (typeof pluginData !== 'object' || Array.isArray(pluginData)) {
            errors.push(`Zone '${zoneName}' field '_plugin' must be an object`);
            return;
        }
        
        // Validate plugin data values
        for (const [key, value] of Object.entries(pluginData)) {
            const valueType = typeof value;
            if (!['string', 'number', 'boolean'].includes(valueType)) {
                errors.push(`Zone '${zoneName}' plugin field '${key}' must be string, number, or boolean`);
            }
        }
    }
    
    /**
     * Validate genital zone specifically
     */
    validateGenitalZone(genitals, errors) {
        if (!genitals || typeof genitals !== 'object') {
            errors.push("Genitals zone must be an object");
            return;
        }
        
        // Must have at least one genital type
        const hasValidGenitalType = this.validationRules.validGenitalTypes.some(type => 
            genitals[type] && typeof genitals[type] === 'object'
        );
        
        if (!hasValidGenitalType) {
            errors.push("Genitals zone must contain at least one of: vagina, penis, anal");
        }
        
        // Validate each genital type present
        for (const type of this.validationRules.validGenitalTypes) {
            if (genitals[type]) {
                this.validateGenitalType(type, genitals[type], errors);
            }
        }
    }
    
    /**
     * Validate specific genital type
     */
    validateGenitalType(type, genitalData, errors) {
        const prefix = `genitals.${type}`;
        
        // Standard zone fields
        this.validateZoneStructure(type, genitalData, errors);
        
        // Type-specific validations
        switch (type) {
            case 'vagina':
                this.validateVaginaFields(genitalData, errors, prefix);
                break;
            case 'penis':
                this.validatePenisFields(genitalData, errors, prefix);
                break;
            case 'anal':
                this.validateAnalFields(genitalData, errors, prefix);
                break;
        }
    }
    
    /**
     * Validate vagina-specific fields
     */
    validateVaginaFields(vaginaData, errors, prefix) {
        // Internal fields
        if (vaginaData.internal) {
            if (typeof vaginaData.internal !== 'object') {
                errors.push(`${prefix}.internal must be an object`);
            } else {
                if (vaginaData.internal.depth_inches !== undefined) {
                    if (typeof vaginaData.internal.depth_inches !== 'number' || vaginaData.internal.depth_inches < 0) {
                        errors.push(`${prefix}.internal.depth_inches must be a number >= 0`);
                    }
                }
            }
        }
        
        // Required fields
        if (!vaginaData.tightness_level || typeof vaginaData.tightness_level !== 'string') {
            errors.push(`${prefix}.tightness_level must be a non-empty string`);
        }
        
        if (vaginaData.ridge_presence !== undefined && typeof vaginaData.ridge_presence !== 'boolean') {
            errors.push(`${prefix}.ridge_presence must be a boolean`);
        }
        
        if (vaginaData.g_spot_ridge !== undefined && typeof vaginaData.g_spot_ridge !== 'string') {
            errors.push(`${prefix}.g_spot_ridge must be a string`);
        }
        
        if (vaginaData.hymen_intact !== undefined && typeof vaginaData.hymen_intact !== 'boolean') {
            errors.push(`${prefix}.hymen_intact must be a boolean`);
        }
    }
    
    /**
     * Validate penis-specific fields
     */
    validatePenisFields(penisData, errors, prefix) {
        // Size fields
        if (penisData.size) {
            if (typeof penisData.size !== 'object') {
                errors.push(`${prefix}.size must be an object`);
            } else {
                const sizeFields = ['length_erect_inches', 'length_flaccid_inches', 'girth_inches'];
                for (const field of sizeFields) {
                    if (penisData.size[field] !== undefined) {
                        if (typeof penisData.size[field] !== 'number' || penisData.size[field] < 0) {
                            errors.push(`${prefix}.size.${field} must be a number >= 0`);
                        }
                    }
                }
            }
        }
        
        // Circumcision field
        if (penisData.circumcised !== undefined && typeof penisData.circumcised !== 'boolean') {
            errors.push(`${prefix}.circumcised must be a boolean`);
        }
    }
    
    /**
     * Validate anal-specific fields
     */
    validateAnalFields(analData, errors, prefix) {
        // Internal fields
        if (analData.internal) {
            if (typeof analData.internal !== 'object') {
                errors.push(`${prefix}.internal must be an object`);
            } else {
                if (analData.internal.depth_inches !== undefined) {
                    if (typeof analData.internal.depth_inches !== 'number' || analData.internal.depth_inches < 0) {
                        errors.push(`${prefix}.internal.depth_inches must be a number >= 0`);
                    }
                }
            }
        }
        
        // Tightness field (optional for anal)
        if (analData.tightness_level !== undefined && typeof analData.tightness_level !== 'string') {
            errors.push(`${prefix}.tightness_level must be a string`);
        }
    }
    
    /**
     * Create validation result object
     */
    createValidationResult(success, errors = []) {
        return {
            success: success,
            errors: errors,
            timestamp: new Date().toISOString(),
            schemaVersion: this.schemaVersion
        };
    }
    
    /**
     * Generate cache key for validation result
     */
    generateCacheKey(bodyMap) {
        // Simple hash based on JSON stringify
        const str = JSON.stringify(bodyMap);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }
    
    /**
     * Cache validation result
     */
    cacheValidationResult(bodyMap, result) {
        if (this.validationCache.size >= this.cacheMaxSize) {
            // Remove oldest entry
            const firstKey = this.validationCache.keys().next().value;
            this.validationCache.delete(firstKey);
        }
        
        const cacheKey = this.generateCacheKey(bodyMap);
        this.validationCache.set(cacheKey, result);
    }
    
    /**
     * Update validation statistics
     */
    updateValidationStats(result, startTime) {
        this.validationStats.totalValidations++;
        
        if (result.success) {
            this.validationStats.successfulValidations++;
        } else {
            this.validationStats.failedValidations++;
            
            // Count error types
            for (const error of result.errors) {
                const errorType = this.categorizeError(error);
                this.validationStats.errorsByType[errorType] = 
                    (this.validationStats.errorsByType[errorType] || 0) + 1;
            }
        }
        
        // Record performance
        this.recordPerformance('validateBodyMap', performance.now() - startTime);
    }
    
    /**
     * Categorize error for statistics
     */
    categorizeError(error) {
        if (error.includes('Missing required zone')) return 'missing_zone';
        if (error.includes('Invalid zone')) return 'invalid_zone';
        if (error.includes('missing required field')) return 'missing_field';
        if (error.includes('must be a')) return 'type_error';
        if (error.includes('genitals.')) return 'genital_validation';
        return 'other';
    }
    
    /**
     * Utility methods
     */
    getRequiredZones() {
        return [...this.validationRules.requiredZones];
    }
    
    getInvalidZones() {
        return [...this.validationRules.invalidZones];
    }
    
    getMuscleZones() {
        return [...this.validationRules.muscleZones];
    }
    
    isValidZone(zoneName) {
        return this.validationRules.requiredZones.includes(zoneName) ||
               this.validationRules.validGenitalTypes.includes(zoneName);
    }
    
    isInvalidZone(zoneName) {
        return this.validationRules.invalidZones.includes(zoneName);
    }
    
    isMuscleZone(zoneName) {
        return this.validationRules.muscleZones.includes(zoneName);
    }
    
    /**
     * Get validation statistics
     */
    getValidationStats() {
        return {
            ...this.validationStats,
            cacheSize: this.validationCache ? this.validationCache.size : 0,
            cacheMaxSize: this.cacheMaxSize || 0
        };
    }
    
    /**
     * Clear validation cache
     */
    clearValidationCache() {
        if (this.validationCache) {
            this.validationCache.clear();
            this.logInfo('Validation cache cleared');
        }
    }
    
    /**
     * Get diagnostics specific to validator
     */
    getDiagnostics() {
        return {
            ...super.getDiagnostics(),
            validationStats: this.getValidationStats(),
            validationRules: {
                requiredZones: this.validationRules.requiredZones.length,
                invalidZones: this.validationRules.invalidZones.length,
                muscleZones: this.validationRules.muscleZones.length,
                validMarkTypes: this.validationRules.validMarkTypes.length,
                validGenitalTypes: this.validationRules.validGenitalTypes.length
            },
            schemaVersion: this.schemaVersion
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadshiftBodyMapValidator;
} else if (typeof window !== 'undefined') {
    window.ThreadshiftBodyMapValidator = ThreadshiftBodyMapValidator;
}