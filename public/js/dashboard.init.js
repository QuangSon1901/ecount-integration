/**
 * dashboard.init.js — Bootstrap entry point.
 * Runs after dashboard.core.js + all section modules are loaded.
 * Calls init() on each section module so they render their HTML into mount points,
 * then fetches the current user and starts the app.
 */

document.addEventListener('DOMContentLoaded', function () {
    // 1. Let each section module render its HTML into the DOM.
    if (window.Customers)    Customers.init();
    if (window.OmsOrders)    OmsOrders.init();
    if (window.OmsPackaging) OmsPackaging.init();
    if (window.ClientPortal) ClientPortal.init();
    if (window.SystemConfig) SystemConfig.init();

    // 2. Init navigation (requires section mounts to already be in the DOM).
    initNavigation();
    initQuickAccessCards();

    // 3. Fetch user → RBAC → navigate to initial section → load data.
    fetchCurrentUser().then(function () {
        if (!currentUser) return;

        if (currentUser.role === 'admin') {
            // Customers dropdown in OMS is loaded lazily inside OmsOrders.init(),
            // so nothing extra needed here.
        } else if (currentUser.role === 'customer') {
            // Populate account info + conditionally load credentials/webhooks.
            if (window.ClientPortal) ClientPortal.loadClientData();
        }

        // Clock
        updateClock();
        setInterval(updateClock, 60000);
    });
});