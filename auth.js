(function () {
    const AUTH_KEY = 'boaLoggedIn';

    window.BoAAuth = {
        login: function () {
            sessionStorage.setItem(AUTH_KEY, 'true');
        },
        logout: function () {
            sessionStorage.removeItem(AUTH_KEY);
        },
        isLoggedIn: function () {
            return sessionStorage.getItem(AUTH_KEY) === 'true';
        },
        requireAuth: function () {
            if (!this.isLoggedIn()) {
                window.location.replace('index.html');
                return false;
            }
            return true;
        }
    };
})();
