/**
 * dashboard.core.js — Auth, navigation, shared utilities.
 * No section-specific logic here. Each section lives in js/sections/*.js
 */

var API = '/api/v1';
var currentUser = null;

// ════════════════════════════════════════════
// AUTH & ROLE
// ════════════════════════════════════════════
function fetchCurrentUser() {
    return fetch(API + '/me')
        .then(function (r) {
            if (!r.ok) { window.location.href = '/login'; return; }
            return r.json();
        })
        .then(function (data) {
            if (data && data.success && data.data) {
                currentUser = data.data;
                renderUserUI();
                applyRBAC();
            } else {
                window.location.href = '/login';
            }
        })
        .catch(function () {
            showAlert('Cannot load user info', 'error');
        });
}

function renderUserUI() {
    if (!currentUser) return;
    var nameEl     = document.getElementById('userName');
    var roleEl     = document.getElementById('userRole');
    var avatarEl   = document.getElementById('userAvatar');
    var subtitleEl = document.getElementById('sidebarSubtitle');

    if (currentUser.role === 'admin') {
        nameEl.textContent     = currentUser.fullName || currentUser.username;
        roleEl.textContent     = 'Administrator';
        avatarEl.textContent   = (currentUser.username || 'A')[0].toUpperCase();
        subtitleEl.textContent = 'Admin Dashboard';
    } else {
        nameEl.textContent     = currentUser.customerName || currentUser.customerCode;
        roleEl.textContent     = 'Customer';
        avatarEl.textContent   = (currentUser.customerCode || 'C')[0].toUpperCase();
        subtitleEl.textContent = 'Customer Portal';
    }
}

function applyRBAC() {
    if (!currentUser) return;
    var role = currentUser.role;

    var els = document.querySelectorAll('[data-role="' + role + '"]');
    for (var i = 0; i < els.length; i++) {
        els[i].classList.add('role-visible');
    }

    var defaultSection = role === 'admin' ? 'admin-overview' : 'client-overview';
    var initialSection = readSectionFromUrl() || defaultSection;
    navigateToSection(initialSection, { replaceHistory: true });
}

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
function initNavigation() {
    var links = document.querySelectorAll('.nav-link[data-section]');
    for (var i = 0; i < links.length; i++) {
        links[i].addEventListener('click', handleNavClick);
    }

    window.addEventListener('popstate', function () {
        var section = readSectionFromUrl();
        if (!section) return;

        var currentActive = document.querySelector('.content-section.active');
        var currentId = currentActive ? currentActive.id : null;

        if (currentId === section) {
            // Same section, params changed (e.g. page) → reload data in section.
            if (section === 'admin-oms-orders' && window.OmsOrders) {
                OmsOrders.omsPage = OmsOrders.readOmsPageFromUrl();
                OmsOrders.loadOmsOrders();
            }
        } else {
            navigateToSection(section, { skipHistory: true });
        }
    });
}

function parseHash() {
    var raw = (window.location.hash || '').replace(/^#/, '').trim();
    if (!raw) return { section: null, params: new URLSearchParams() };
    var qIdx = raw.indexOf('?');
    var section = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    var params  = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');
    return { section: section, params: params };
}

function readSectionFromUrl() {
    var section = parseHash().section;
    if (!section) return null;
    var target = document.getElementById(section);
    if (!target || !target.classList.contains('content-section')) return null;
    return section;
}

// Build hash from section + params object. Omit empty/zero keys for clean URLs.
function buildHash(section, paramsObj) {
    var qs = new URLSearchParams();
    if (paramsObj) {
        Object.keys(paramsObj).forEach(function (k) {
            var v = paramsObj[k];
            if (v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && v === 0)) {
                qs.set(k, String(v));
            }
        });
    }
    var qsStr = qs.toString();
    return '#' + section + (qsStr ? '?' + qsStr : '');
}

// Update only current params (keep section). Uses pushState so back button works.
function setUrlParams(paramsObj, options) {
    options = options || {};
    var current = parseHash();
    if (!current.section) return;
    var newHash = buildHash(current.section, paramsObj);
    if (window.location.hash === newHash) return;
    try {
        if (options.replace) window.history.replaceState({ section: current.section }, '', newHash);
        else                 window.history.pushState({ section: current.section }, '', newHash);
    } catch (_) {
        window.location.hash = newHash;
    }
}

function handleNavClick(e) {
    var section = this.getAttribute('data-section');
    if (section) {
        if (e && e.preventDefault) e.preventDefault();
        navigateToSection(section);
        setActiveNav(this);
    }
}

var pageTitles = {
    'admin-overview':        { t: 'Dashboard Overview',   s: 'System overview and quick actions' },
    'admin-customers':       { t: 'API Customers',        s: 'Manage API customers' },
    'admin-create-customer': { t: 'Create Customer',      s: 'Create new API customer' },
    'admin-oms-orders':      { t: 'OMS Orders',           s: 'Outbound request management' },
    'admin-oms-packaging':   { t: 'OMS Packaging & SKU',  s: 'Vật liệu đóng gói & mapping SKU' },
    'admin-tools':           { t: 'Internal Tools',       s: 'Admin-only tools and extensions' },
    'admin-system-config':   { t: 'System Config',        s: 'Seller profiles & system configuration' },
    'client-overview':       { t: 'Account Overview',     s: 'Your account information' },
    'client-credentials':    { t: 'API Credentials',      s: 'Your Client ID and Secret Key' },
    'client-webhooks':       { t: 'Webhooks',             s: 'Manage webhook registrations' },
    'api-docs':              { t: 'API Documentation',    s: 'THG-FULFILL Open API reference' },
    'public-extensions':     { t: 'Public Extensions',    s: 'Chrome extensions for ECount' }
};

function navigateToSection(sectionId, options) {
    options = options || {};

    var sections = document.querySelectorAll('.content-section');
    for (var i = 0; i < sections.length; i++) {
        sections[i].classList.remove('active');
    }

    var target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
        updatePageTitle(sectionId);

        // Delegate section-specific data loading to each module.
        if (sectionId === 'admin-customers'    && window.Customers)  Customers.loadCustomers();
        if (sectionId === 'admin-oms-orders'   && window.OmsOrders) {
            OmsOrders.omsPage = OmsOrders.readOmsPageFromUrl();
            OmsOrders.loadOmsOrders();
        }
        if (sectionId === 'admin-oms-packaging' && window.OmsPackaging) {
            if (OmsPackaging.getActiveView() === 'mappings') OmsPackaging.loadMappings();
            else                                              OmsPackaging.loadMaterials();
        }
        if (sectionId === 'client-credentials'   && window.ClientPortal) ClientPortal.loadCredentials();
        if (sectionId === 'client-webhooks'      && window.ClientPortal) ClientPortal.loadWebhooks();
        if (sectionId === 'admin-system-config'  && window.SystemConfig) SystemConfig.onActivate();
    }

    var navLink = document.querySelector('.nav-link[data-section="' + sectionId + '"]');
    if (navLink) setActiveNav(navLink);

    if (!options.skipHistory) {
        var newHash = '#' + sectionId;
        if (window.location.hash !== newHash) {
            try {
                if (options.replaceHistory) {
                    window.history.replaceState({ section: sectionId }, '', newHash);
                } else {
                    window.history.pushState({ section: sectionId }, '', newHash);
                }
            } catch (_) {
                window.location.hash = newHash;
            }
        }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setActiveNav(activeLink) {
    var all = document.querySelectorAll('.nav-link');
    for (var i = 0; i < all.length; i++) {
        all[i].classList.remove('active');
    }
    activeLink.classList.add('active');
}

function updatePageTitle(sectionId) {
    var info = pageTitles[sectionId] || { t: 'Dashboard', s: '' };
    setText('pageTitle',    info.t);
    setText('pageSubtitle', info.s);
}

function initQuickAccessCards() {
    var cards = document.querySelectorAll('.stat-card.clickable[data-navigate]');
    for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function () {
            var nav = this.getAttribute('data-navigate');
            if (nav) navigateToSection(nav);
        });
    }
}

function updateClock() {
    var el = document.getElementById('lastUpdate');
    if (el) el.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// ════════════════════════════════════════════
// SHARED UTILITIES
// ════════════════════════════════════════════
function showAlert(msg, type) {
    var container = document.getElementById('alertContainer');
    if (!container) return;
    var div = document.createElement('div');
    div.className   = 'alert alert-' + (type || 'success') + ' show';
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(function () {
        div.classList.remove('show');
        setTimeout(function () { div.remove(); }, 300);
    }, 5000);
}

function esc(text) {
    if (!text) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
}

function fmtDate(str) {
    var d = new Date(str);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtDatetime(s) {
    if (!s) return '—';
    var d = new Date(s);
    return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
    if (n === null || n === undefined || n === '') return '—';
    return Number(n).toFixed(2);
}

function statusBadge(s) {
    return s === 'active' ? 'success' : s === 'suspended' ? 'warning' : 'danger';
}

function formatTelegramTags(str) {
    if (!str) return '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
    var tags = str.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    return tags.map(function (tag) {
        return '<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:11px;margin:1px 2px;">' + esc(tag) + '</span>';
    }).join('');
}

function formatTelegramGroups(str) {
    if (!str) return '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
    var groups = str.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
    return '<span style="color:var(--text-secondary);font-size:11px;">' + groups.length + ' group' + (groups.length > 1 ? 's' : '') + '</span>';
}

function formatLarkGroups(str) {
    if (!str) return '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
    var groups = str.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
    return '<span style="color:var(--text-secondary);font-size:11px;">' + groups.length + ' group' + (groups.length > 1 ? 's' : '') + '</span>';
}

function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
}

function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function copyField(id) {
    var input = document.getElementById(id);
    if (!input || !input.value) return;
    copyText(input.value, 'Copied to clipboard!');
}

function copyText(text, msg) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { showAlert(msg || 'Copied!', 'success'); });
    } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showAlert(msg || 'Copied!', 'success');
    }
}

function addClick(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

function addChange(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', fn);
}