(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Sidebar navigation + scroll-spy
  // ---------------------------------------------------------------------------

  function initSidebarNav() {
    var navLinks = document.querySelectorAll('.docs-nav-link[data-section]');
    var sections = document.querySelectorAll('.docs-section');

    if (!navLinks.length || !sections.length) {
      return;
    }

    // Smooth-scroll to section on click
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].addEventListener('click', function (e) {
        var sectionId = this.getAttribute('data-section');
        var target = document.getElementById(sectionId);

        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActiveNavLink(sectionId);
        }
      });
    }

    // Scroll-spy: highlight the nav link for whichever section is most in view
    if ('IntersectionObserver' in window) {
      var visibleSections = {};

      var observer = new IntersectionObserver(
        function (entries) {
          for (var j = 0; j < entries.length; j++) {
            var entry = entries[j];
            visibleSections[entry.target.id] = entry.intersectionRatio;
          }

          // Pick the section with the highest intersection ratio
          var topSectionId = null;
          var topRatio = 0;
          for (var id in visibleSections) {
            if (visibleSections[id] > topRatio) {
              topRatio = visibleSections[id];
              topSectionId = id;
            }
          }

          if (topSectionId) {
            setActiveNavLink(topSectionId);
          }
        },
        {
          root: null,
          rootMargin: '0px 0px -60% 0px',
          threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
        }
      );

      for (var k = 0; k < sections.length; k++) {
        observer.observe(sections[k]);
      }
    } else {
      // Fallback: plain scroll event for older browsers
      document.addEventListener('scroll', function () {
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var activeSectionId = null;

        for (var m = 0; m < sections.length; m++) {
          var section = sections[m];
          var offsetTop = section.offsetTop;

          if (scrollTop >= offsetTop - 120) {
            activeSectionId = section.id;
          }
        }

        if (activeSectionId) {
          setActiveNavLink(activeSectionId);
        }
      });
    }
  }

  function setActiveNavLink(sectionId) {
    var navLinks = document.querySelectorAll('.docs-nav-link[data-section]');

    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];

      if (link.getAttribute('data-section') === sectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Code tab switching
  // ---------------------------------------------------------------------------

  function initCodeTabs() {
    // Each independent group of tabs is identified by a shared parent.
    // We attach a single delegated listener on the document and resolve
    // sibling .code-blocks from the clicked tab's nearest ancestor that
    // contains both .code-tabs and .code-blocks.
    document.addEventListener('click', function (e) {
      var tab = e.target;

      // Walk up to find a .code-tab element (handles clicks on child nodes)
      while (tab && tab !== document) {
        if (tab.classList && tab.classList.contains('code-tab')) {
          break;
        }
        tab = tab.parentNode;
      }

      if (!tab || tab === document) {
        return;
      }

      var lang = tab.getAttribute('data-lang');
      if (!lang) {
        return;
      }

      // Find the parent container that holds both tabs and blocks
      var container = findCodeContainer(tab);
      if (!container) {
        return;
      }

      // Switch active tab
      var allTabs = container.querySelectorAll('.code-tab');
      for (var i = 0; i < allTabs.length; i++) {
        allTabs[i].classList.remove('active');
      }
      tab.classList.add('active');

      // Switch active code block
      var allBlocks = container.querySelectorAll('.code-block');
      for (var j = 0; j < allBlocks.length; j++) {
        var block = allBlocks[j];

        if (block.getAttribute('data-lang') === lang) {
          block.classList.add('active');
        } else {
          block.classList.remove('active');
        }
      }
    });
  }

  // Walk up the DOM until we find an ancestor that contains both
  // .code-tabs and .code-blocks, or fall back to the document body.
  function findCodeContainer(element) {
    var node = element.parentNode;

    while (node && node !== document) {
      if (
        node.querySelector('.code-tab') &&
        node.querySelector('.code-block')
      ) {
        return node;
      }
      node = node.parentNode;
    }

    return document.body;
  }

  // ---------------------------------------------------------------------------
  // Copy-code button
  // ---------------------------------------------------------------------------

  function initCopyButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target;

      // Walk up to find a .copy-code-btn element
      while (btn && btn !== document) {
        if (btn.classList && btn.classList.contains('copy-code-btn')) {
          break;
        }
        btn = btn.parentNode;
      }

      if (!btn || btn === document) {
        return;
      }

      var codeEl = findAdjacentCode(btn);
      if (!codeEl) {
        return;
      }

      var textToCopy = codeEl.innerText || codeEl.textContent || '';

      copyToClipboard(textToCopy, btn);
    });
  }

  // Look for a <code> element that is either:
  //   1. A direct sibling <pre> > <code> of the button, or
  //   2. Inside the nearest common ancestor that also contains a .code-block
  function findAdjacentCode(btn) {
    // Try the nearest .code-block sibling or cousin first
    var container = btn.parentNode;

    while (container && container !== document) {
      var block = container.querySelector('.code-block.active code');
      if (block) {
        return block;
      }

      // No active block? Try any code block
      block = container.querySelector('.code-block code');
      if (block) {
        return block;
      }

      // Try a plain <pre><code> nearby
      block = container.querySelector('pre code');
      if (block) {
        return block;
      }

      container = container.parentNode;
    }

    return null;
  }

  function copyToClipboard(text, btn) {
    var originalLabel = btn.textContent;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () {
          showCopiedFeedback(btn, originalLabel);
        },
        function () {
          fallbackCopy(text, btn, originalLabel);
        }
      );
    } else {
      fallbackCopy(text, btn, originalLabel);
    }
  }

  function fallbackCopy(text, btn, originalLabel) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
      showCopiedFeedback(btn, originalLabel);
    } catch (err) {
      // Silent failure — the browser may have blocked it
    }

    document.body.removeChild(textarea);
  }

  function showCopiedFeedback(btn, originalLabel) {
    btn.textContent = 'Copied!';
    btn.classList.add('copy-code-btn--copied');

    setTimeout(function () {
      btn.textContent = originalLabel;
      btn.classList.remove('copy-code-btn--copied');
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  function init() {
    initSidebarNav();
    initCodeTabs();
    initCopyButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
