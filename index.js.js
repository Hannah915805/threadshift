// index.js - Threadshift Plugin Entry Point (Testing Version)

// Simple script-based loading for SillyTavern compatibility
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// Create global Threadshift namespace
window.Threadshift = {
  config: null,
  foundation: {},
  core: {},
  modules: {},
  initialized: false,
  status: 'uninitialized'
};

// Test helper for debugging
window.Threadshift.debug = {
  logStep: (step, success, data) => {
    const status = success ? '✅' : '❌';
    console.log(`${status} Step ${step}:`, data);
  },
  getStatus: () => {
    return {
      status: window.Threadshift.status,
      initialized: window.Threadshift.initialized,
      loadedModules: {
        foundation: Object.keys(window.Threadshift.foundation),
        core: Object.keys(window.Threadshift.core),
        modules: Object.keys(window.Threadshift.modules)
      }
    };
  }
};

// Async bootstrapper
(async function initializeThreadshift() {
  try {
    console.log('🚀 Starting Threadshift initialization...');
    
    // Load all module scripts first
    const moduleFiles = [
      './Threadshiftmodule.js',
      './Threadshiftconfig.js',
      './St-storage-manager.js',
      './Zoneswapengine.js',
      './Sessionmanager.js',
      './Historytracker.js',
      './Garmentinventory.js',
      './Bodymapvalidator.js',
      './Multicharacterhandler.js',
      './Errorhandler.js'
    ];
    
    for (const file of moduleFiles) {
      try {
        await loadScript(file);
        window.Threadshift.debug.logStep(`Load ${file}`, true);
      } catch (error) {
        window.Threadshift.debug.logStep(`Load ${file}`, false, error.message);
        throw new Error(`Failed to load ${file}: ${error.message}`);
      }
    }

    // STEP 1: Config
    if (!window.ThreadshiftConfig) throw new Error('ThreadshiftConfig not loaded');
    const config = ThreadshiftConfig.getInstance();
    if (config.initialize) await config.initialize();
    window.Threadshift.config = config;
    window.Threadshift.debug.logStep('Config', true, 'Config initialized');

    // STEP 2: Error Handler
    if (!window.ThreadshiftErrorHandler) throw new Error('ThreadshiftErrorHandler not loaded');
    const errorHandler = new ThreadshiftErrorHandler();
    if (errorHandler.initialize) await errorHandler.initialize();
    window.Threadshift.foundation.errorHandler = errorHandler;
    window.Threadshift.debug.logStep('ErrorHandler', true, 'Error handler ready');

    // STEP 3: Storage Manager
    if (!window.ThreadshiftStorageManager) throw new Error('ThreadshiftStorageManager not loaded');
    const storage = new ThreadshiftStorageManager();
    if (storage.initialize) await storage.initialize();
    window.Threadshift.foundation.storage = storage;
    window.Threadshift.debug.logStep('Storage', true, 'Storage manager ready');

    // STEP 4: Session Manager
    if (!window.ThreadshiftSessionManager) throw new Error('ThreadshiftSessionManager not loaded');
    const session = new ThreadshiftSessionManager();
    if (session.initialize) await session.initialize();
    window.Threadshift.foundation.session = session;
    window.Threadshift.debug.logStep('Session', true, 'Session manager ready');

    // STEP 5: Body Map Validator
    if (!window.ThreadshiftBodyMapValidator) throw new Error('ThreadshiftBodyMapValidator not loaded');
    const validator = new ThreadshiftBodyMapValidator();
    if (validator.initialize) await validator.initialize();
    window.Threadshift.foundation.bodyMapValidator = validator;
    window.Threadshift.debug.logStep('Validator', true, 'Body map validator ready');

    // STEP 6: Garment Inventory
    if (!window.ThreadshiftGarmentInventory) throw new Error('ThreadshiftGarmentInventory not loaded');
    const inventory = new ThreadshiftGarmentInventory();
    if (inventory.initialize) await inventory.initialize();
    window.Threadshift.core.inventory = inventory;
    window.Threadshift.debug.logStep('Inventory', true, 'Garment inventory ready');

    // STEP 7: Zone Swap Engine
    if (!window.ThreadshiftZoneSwapEngine) throw new Error('ThreadshiftZoneSwapEngine not loaded');
    const engine = new ThreadshiftZoneSwapEngine();
    // Inject dependencies
    engine.garmentZoneMapper = inventory;
    engine.bodyMapValidator = validator;
    if (engine.initialize) await engine.initialize();
    window.Threadshift.core.engine = engine;
    window.Threadshift.debug.logStep('Engine', true, 'Zone swap engine ready');

    // STEP 8: Multi-Character Handler
    if (!window.ThreadshiftMultiCharacterHandler) throw new Error('ThreadshiftMultiCharacterHandler not loaded');
    const mch = new ThreadshiftMultiCharacterHandler();
    if (mch.initialize) await mch.initialize();
    window.Threadshift.modules.multiCharacter = mch;
    window.Threadshift.debug.logStep('MultiChar', true, 'Multi-character handler ready');

    // STEP 9: History Tracker
    if (!window.ThreadshiftHistoryTracker) throw new Error('ThreadshiftHistoryTracker not loaded');
    const history = new ThreadshiftHistoryTracker();
    if (history.initialize) await history.initialize();
    window.Threadshift.modules.history = history;
    window.Threadshift.debug.logStep('History', true, 'History tracker ready');

    // Finalize
    window.Threadshift.initialized = true;
    window.Threadshift.status = 'ready';
    
    console.log('✅ Threadshift initialized successfully');
    console.log('🔍 Use window.Threadshift.debug.getStatus() to inspect state');

    // Fire event for SillyTavern or UI panels
    const evt = new CustomEvent('threadshift_ready', {
      detail: {
        initialized: true,
        version: config?.data?.version || 'unknown',
        modules: window.Threadshift.debug.getStatus().loadedModules
      }
    });
    window.dispatchEvent(evt);

  } catch (error) {
    console.error('❌ Threadshift initialization failed:', error);
    window.Threadshift.status = 'error';
    window.Threadshift.debug.logStep('FATAL', false, error.message);
    
    // Try to use error handler if available
    if (window.Threadshift?.foundation?.errorHandler?.handleError) {
      window.Threadshift.foundation.errorHandler.handleError(
        'index.js',
        'initialization',
        error,
        { critical: true }
      );
    }
  }
})();