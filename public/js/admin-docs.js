// ═══════════════════════════════════════════════════════
// Admin Documentation — Navigation & Interactivity
// ═══════════════════════════════════════════════════════

(function () {
    'use strict';

    // ─── Section titles for header ───
    var sectionMeta = {
        'overview':           { title: 'System Architecture',        subtitle: 'Architecture overview and system goals' },
        'components':         { title: 'Core Components',            subtitle: 'Directory structure, middleware pipeline, controllers' },
        'database':           { title: 'Database Schema',            subtitle: '14 tables across 32 migrations' },
        'roadmap':            { title: 'Development Roadmap',        subtitle: 'Phases, modules, and future directions' },
        'extensions':         { title: 'Extensions',                 subtitle: 'Chrome extensions for ERP workflow' },

        // Operations Guide
        'ops-create-customer':  { title: 'Tạo Customer mới',          subtitle: 'Hướng dẫn tạo khách hàng API từ đầu đến cuối' },
        'ops-customer-detail':  { title: 'Quản lý chi tiết Customer', subtitle: 'Xem, chỉnh sửa thông tin và reset mật khẩu' },
        'ops-credentials':      { title: 'Credentials & API Keys',    subtitle: 'Tạo, làm mới và thu hồi client_id + secret' },
        'ops-webhooks':         { title: 'Quản lý Webhooks',          subtitle: 'Đăng ký, xóa webhook và xem delivery logs' },
        'ops-customer-portal':  { title: 'Customer Portal',           subtitle: 'Góc nhìn khách hàng khi sử dụng hệ thống' },
        'ops-sandbox':          { title: 'Sandbox & Feature Flags',   subtitle: 'Environment, bulk_order_enabled, webhook_enabled' },

        // Services & Features
        'services':           { title: 'Core Services',              subtitle: 'Service layer architecture and business logic' },
        'carriers':           { title: 'Carrier Integration',        subtitle: 'YunExpress VN/CN and base carrier pattern' },
        'erp':                { title: 'ERP Integration',            subtitle: 'ECount OAPI, Puppeteer, and Playwright automation' },
        'jobs':               { title: 'Jobs & Workers',             subtitle: 'Background processing and cron scheduling' },
        'webhooks-service':   { title: 'Webhook System',             subtitle: 'Event dispatch, delivery, and signature verification' },
        'customers-service':  { title: 'Customer Management',        subtitle: 'Lifecycle, credentials, feature flags, rate limits' },
        'api-overview':       { title: 'Open API Overview',          subtitle: 'REST API architecture and response format' },
        'api-auth':           { title: 'API Authentication',         subtitle: 'OAuth2 client credentials and JWT tokens' },
        'api-endpoints':      { title: 'API Endpoints',              subtitle: '46+ endpoints across all modules' },
        'api-integration':    { title: 'Integration Guide',          subtitle: 'Step-by-step client integration flow' }
    };

    // ─── Navigate to section ───
    function navigateToSection(sectionId) {
        // Hide all sections
        var sections = document.querySelectorAll('.doc-section');
        for (var i = 0; i < sections.length; i++) {
            sections[i].classList.remove('active');
        }

        // Show target section
        var target = document.getElementById('section-' + sectionId);
        if (target) {
            target.classList.add('active');
        }

        // Update nav links
        var links = document.querySelectorAll('.nav-link');
        for (var j = 0; j < links.length; j++) {
            links[j].classList.remove('active');
            if (links[j].getAttribute('data-section') === sectionId) {
                links[j].classList.add('active');
            }
        }

        // Update header
        var meta = sectionMeta[sectionId];
        if (meta) {
            var titleEl = document.getElementById('pageTitle');
            var subtitleEl = document.getElementById('pageSubtitle');
            if (titleEl) titleEl.textContent = meta.title;
            if (subtitleEl) subtitleEl.textContent = meta.subtitle;
        }

        // Scroll to top
        window.scrollTo(0, 0);

        // Update URL hash
        if (history.replaceState) {
            history.replaceState(null, '', '#' + sectionId);
        }
    }

    // ─── Init nav click handlers ───
    function initNavigation() {
        var links = document.querySelectorAll('.nav-link[data-section]');
        for (var i = 0; i < links.length; i++) {
            links[i].addEventListener('click', function () {
                var section = this.getAttribute('data-section');
                if (section) navigateToSection(section);
            });
        }
    }

    // ─── Handle URL hash on load ───
    function handleHash() {
        var hash = window.location.hash.replace('#', '');
        if (hash && sectionMeta[hash]) {
            navigateToSection(hash);
        }
    }

    // ─── Toggle phase cards ───
    function initPhaseToggles() {
        var phaseHeaders = document.querySelectorAll('.phase-header');
        for (var i = 0; i < phaseHeaders.length; i++) {
            phaseHeaders[i].addEventListener('click', function () {
                var body = this.nextElementSibling;
                if (body && body.classList.contains('phase-body')) {
                    if (body.style.display === 'none') {
                        body.style.display = 'block';
                    } else {
                        body.style.display = 'none';
                    }
                }
            });
        }
    }

    // ─── Keyboard navigation ───
    function initKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Ctrl+K or Cmd+K — focus search (future feature)
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
            }
        });
    }

    // ─── Init ───
    document.addEventListener('DOMContentLoaded', function () {
        initNavigation();
        initPhaseToggles();
        initKeyboard();
        handleHash();
    });

})();
