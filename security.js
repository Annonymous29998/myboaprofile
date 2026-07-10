(function () {
    'use strict';

    var isProduction = (function () {
        var host = window.location.hostname;
        return host !== 'localhost' &&
            host !== '127.0.0.1' &&
            host !== '' &&
            window.location.protocol !== 'file:';
    })();

    if (!isProduction) {
        return;
    }

    var blocked = false;

    function blockAccess() {
        if (blocked) {
            return;
        }
        blocked = true;
        try {
            window.stop();
        } catch (e) {}
        document.documentElement.innerHTML =
            '<head><meta charset="UTF-8"><title>Access Denied</title></head>' +
            '<body style="margin:0;font-family:Arial,sans-serif;display:flex;align-items:center;' +
            'justify-content:center;min-height:100vh;background:#fff;color:#333;">' +
            '<p style="padding:20px;text-align:center;">Unauthorized access is not permitted.</p></body>';
    }

    function isAllowedScriptSrc(src) {
        if (!src) {
            return true;
        }
        try {
            var url = new URL(src, window.location.href);
            return url.origin === window.location.origin ||
                url.hostname === 'cdnjs.cloudflare.com';
        } catch (e) {
            return false;
        }
    }

    function stripUnsafeNode(node) {
        if (!node || node.nodeType !== 1) {
            return;
        }

        if (node.tagName === 'SCRIPT' && node.src && !isAllowedScriptSrc(node.src)) {
            node.remove();
            blockAccess();
            return;
        }

        if (node.tagName === 'IFRAME' || node.tagName === 'OBJECT' || node.tagName === 'EMBED') {
            node.remove();
            blockAccess();
            return;
        }

        var attrs = node.attributes;
        if (!attrs) {
            return;
        }

        for (var i = 0; i < attrs.length; i++) {
            var name = attrs[i].name.toLowerCase();
            if (name.indexOf('on') === 0) {
                node.removeAttribute(attrs[i].name);
                blockAccess();
            }
        }
    }

    function scanNode(node) {
        stripUnsafeNode(node);
        if (!node.querySelectorAll) {
            return;
        }
        node.querySelectorAll('script, iframe, object, embed').forEach(function (el) {
            stripUnsafeNode(el);
        });
        node.querySelectorAll('*').forEach(stripUnsafeNode);
    }

    function blockDevToolsKeys(event) {
        var key = (event.key || '').toUpperCase();
        var ctrl = event.ctrlKey || event.metaKey;
        var shift = event.shiftKey;

        if (key === 'F12') {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (ctrl && shift && (key === 'I' || key === 'J' || key === 'C')) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (ctrl && key === 'U') {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (event.metaKey && event.altKey && (key === 'I' || key === 'J' || key === 'C')) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
    }

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function detectDevTools() {
        if (isMobileDevice()) {
            return;
        }

        var threshold = 160;
        var widthGap = window.outerWidth - window.innerWidth > threshold;
        var heightGap = window.outerHeight - window.innerHeight > threshold;

        if (widthGap || heightGap) {
            blockAccess();
        }
    }

    function detectConsole() {
        var trap = new Image();
        Object.defineProperty(trap, 'id', {
            get: function () {
                blockAccess();
                return '';
            }
        });
        console.log(trap);
    }

    document.addEventListener('contextmenu', function (event) {
        event.preventDefault();
    }, true);

    document.addEventListener('keydown', blockDevToolsKeys, true);

    window.addEventListener('resize', detectDevTools);
    setInterval(detectDevTools, 1000);
    setInterval(detectConsole, 2000);

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                scanNode(node);
            });
        });
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href', 'onclick', 'onload', 'onerror']
    });

    window.eval = function () {
        blockAccess();
        throw new Error('Eval is disabled');
    };
})();