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
    var bootComplete = false;
    var allowedScripts = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var allowedScriptIds = [];

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

    function markScriptAllowed(script) {
        if (!script) {
            return;
        }
        if (allowedScripts) {
            allowedScripts.add(script);
        } else {
            allowedScriptIds.push(script);
        }
    }

    function isScriptAllowed(script) {
        if (!script) {
            return false;
        }
        if (allowedScripts) {
            return allowedScripts.has(script);
        }
        return allowedScriptIds.indexOf(script) !== -1;
    }

    function isInjectedScript(script) {
        if (!script || script.tagName !== 'SCRIPT') {
            return false;
        }
        if (script.src && !isAllowedScriptSrc(script.src)) {
            return true;
        }
        if (!bootComplete) {
            return false;
        }
        return !isScriptAllowed(script);
    }

    function stripUnsafeNode(node) {
        if (!node || node.nodeType !== 1) {
            return;
        }

        if (node.tagName === 'SCRIPT') {
            if (isInjectedScript(node)) {
                node.remove();
                blockAccess();
                return;
            }
            if (!bootComplete && (!node.src || isAllowedScriptSrc(node.src))) {
                markScriptAllowed(node);
            }
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

    function snapshotAllowedScripts() {
        document.querySelectorAll('script').forEach(function (script) {
            if (!script.src || isAllowedScriptSrc(script.src)) {
                markScriptAllowed(script);
            }
        });
        bootComplete = true;
    }

    function blockDevToolsKeys(event) {
        var key = (event.key || '').toUpperCase();
        var ctrl = event.ctrlKey || event.metaKey;
        var shift = event.shiftKey;
        var alt = event.altKey;

        if (key === 'F12') {
            event.preventDefault();
            event.stopPropagation();
            blockAccess();
            return false;
        }

        if (ctrl && shift && (key === 'I' || key === 'J' || key === 'C' || key === 'K')) {
            event.preventDefault();
            event.stopPropagation();
            blockAccess();
            return false;
        }

        if (ctrl && key === 'U') {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (ctrl && shift && key === 'E') {
            event.preventDefault();
            event.stopPropagation();
            blockAccess();
            return false;
        }

        if (event.metaKey && alt && (key === 'I' || key === 'J' || key === 'C')) {
            event.preventDefault();
            event.stopPropagation();
            blockAccess();
            return false;
        }

        if (event.metaKey && alt && key === 'U') {
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

    document.addEventListener('contextmenu', function (event) {
        event.preventDefault();
    }, true);

    document.addEventListener('keydown', blockDevToolsKeys, true);
    document.addEventListener('keyup', blockDevToolsKeys, true);

    window.addEventListener('resize', detectDevTools);
    setInterval(detectDevTools, 1000);

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                scanNode(node);
            });
            if (mutation.type === 'attributes' && mutation.target) {
                stripUnsafeNode(mutation.target);
            }
        });
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href', 'onclick', 'onload', 'onerror']
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', snapshotAllowedScripts);
    } else {
        snapshotAllowedScripts();
    }

    window.eval = function () {
        blockAccess();
        throw new Error('Eval is disabled');
    };

    window.Function = function () {
        blockAccess();
        throw new Error('Function constructor is disabled');
    };
})();
