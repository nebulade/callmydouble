'use strict';

/* global superagent */
/* global $ */

var context = {};
context.fragments = {};

// *********************************************
//  Navbar Fragment
// *********************************************

function NavbarFragment (context) {
    var that = this;

    this.container = $('#box-navbar');
    this.buttonGetADouble = $('#get-a-double-button');
    this.buttonLogin = $('#login-button');
    this.buttonLogout = $('#logout-button');
    this.buttonSignup = $('#signup-button');
    this.buttonDeleteAccount = $('#delete-account-button');

    this.confirmDialog = $('#modal-account-delete');
    this.confirmDialogButtonOk = $('#modal-account-delete-ok');
    this.confirmDialogButtonCancel = $('#modal-account-delete-cancel');

    this.buttonGetADouble.click(function () {
        showFragment(context.fragments.login);
    });

    this.buttonSignup.click(function () {
        showFragment(context.fragments.signup);
    });

    this.buttonLogin.click(function () {
        showFragment(context.fragments.login);
    });

    this.buttonLogout.click(function (event) {
        $.removeCookie('userToken');
        window.location.href = '/';
    });

    this.buttonDeleteAccount.click(function (event) {
        that.confirmDialog.modal('show');
    });

    this.confirmDialogButtonOk.click(function () {
        that.confirmDialog.modal('hide');

        superagent.post('/api/v1/users/signoff').withCredentials().query({ userToken: $.cookie('userToken') }).end(function (error, result) {
            if (error || !result.ok) {
                console.error('Failed to delete the account.', error, result && result.status);
                return;
            }

            $.removeCookie('userToken');
            window.location.href = '/';
        });
    });

    this.confirmDialogButtonCancel.click(function (event) {
        that.confirmDialog.modal('hide');
    });
}

NavbarFragment.prototype.show = function () {
    this.container.show();
};

NavbarFragment.prototype.hide = function () {
    this.container.hide();
};



// *********************************************
//  Welcome Fragment
// *********************************************

function WelcomeFragment (context) {
    this.context = context;
    this.container = $('#box-welcome');
}

WelcomeFragment.prototype.show = function () {
    this.container.show();
    this.context.navbar.buttonLogout.hide();
    this.context.navbar.buttonLogin.show();
    this.context.navbar.buttonSignup.show();
    this.context.navbar.buttonDeleteAccount.hide();
};

WelcomeFragment.prototype.hide = function () {
    this.container.hide();
};



// *********************************************
//  Login Fragment
// *********************************************

function LoginFragment (context) {
    var that = this;
    this.context = context;

    this.container = $('#box-login');
    this.form = $('#form-generate');
    this.email = $('#form-generate input[name=email]');
    this.password = $('#form-generate input[name=password]');
    this.remember = $('#form-generate input[name=remember]');

    this.form.submit(function (event) {
        event.preventDefault();

        superagent.post('/api/v1/users/login').withCredentials().auth(that.email.val(), that.password.val()).end(function (error, result) {
            if (error || !result.ok) {
                console.error('Failed to sign in.', error, result && result.status);
                that.password.val('');
                that.email.parent().addClass('has-error');
                that.password.parent().addClass('has-error');
                return;
            }

            $.cookie('userToken', result.body.userToken, { expires: (that.remember.is(':checked') ? 7 : null ) });
            that.email.parent().removeClass('has-error');
            that.password.parent().removeClass('has-error');

            getApplicationDetails(function (error, result) {
                if (error) {
                    console.error('Failed to get details.', error);
                    return;
                }

                context.fragments.application.fillForm(result.appKey, result.appSecret);
                showFragment(context.fragments.application);
            });
        });
    });
}

LoginFragment.prototype.show = function () {
    this.container.show();
    this.context.navbar.buttonSignup.show();
    this.context.navbar.buttonLogout.hide();
    this.context.navbar.buttonLogin.hide();
    this.context.navbar.buttonDeleteAccount.hide();
};

LoginFragment.prototype.hide = function () {
    this.container.hide();
};



// *********************************************
//  Signup Fragment
// *********************************************

function SignupFragment (context) {
    var that = this;
    this.context = context;

    this.container = $('#box-signup');
    this.form = $('#signup-form');
    this.email = $('#signup-form input[name=email]');
    this.password = $('#signup-form input[name=password]');
    this.passwordRepeat = $('#signup-form input[name=password-repeat]');

    this.form.submit(function (event) {
        event.preventDefault();

        if (that.password.val() !== that.passwordRepeat.val()) {
            console.error('Passwords don\'t match');
            that.passwordRepeat.val('');
            that.passwordRepeat.parent().addClass('has-error');
            return;
        }

        superagent.post('/api/v1/users/signup').auth(that.email.val(), that.password.val()).end(function (error, result) {
            if (error) {
                console.error('Unable to reach the server.', error);
                return;
            }

            if (result.status === 409) {
                console.error('User %s already exists.', that.email.val());
                that.email.parent().addClass('has-error');
                return;
            }

            if (!result.ok) {
                console.error('Unable to register new account "%s".', that.email.val());
                return;
            }

            console.log('Account for user %s created.', that.email.val());

            $.cookie('userToken', result.body.userToken);
            console.log(that.passwordRepeat);
            that.passwordRepeat.parent().removeClass('has-error');
            that.email.parent().removeClass('has-error');
            context.fragments.application.fillForm(result.body.appKey, result.body.appSecret);
            showFragment(context.fragments.application);
        });
    });
}

SignupFragment.prototype.show = function () {
    this.container.show();
    this.context.navbar.buttonSignup.hide();
    this.context.navbar.buttonLogout.hide();
    this.context.navbar.buttonLogin.show();
    this.context.navbar.buttonDeleteAccount.hide();
};

SignupFragment.prototype.hide = function () {
    this.container.hide();
};



// *********************************************
//  Application Fragment
// *********************************************

function ApplicationFragment (context) {
    var that = this;
    this.context = context;

    this.container = $('#box-application');
    this.confirmDialog = $('#modal-confirm');
    this.confirmDialogButtonOk = $('#modal-confirm-ok');
    this.confirmDialogButtonCancel = $('#modal-confirm-cancel');
    this.buttonRefresh = $('#app-refresh-button');
    this.inputAppKey = $('#application-key');
    this.inputAppSecret = $('#application-secret');
    this.inputCallbackUrl = $('#callback-url');
    this.usageAppKeyLabel = $('#usage-app-key');
    this.usageAppSecretLabel = $('#usage-app-secret');
    this.usageRemoteLabel = $('#usage-remote');
    this.usageExampleUrlLabel = $('#usage-example-url');

    // IE does not suppprt this
    if (window.location.origin) {
        this.origin = window.location.origin;
    } else {
        this.origin = window.location.protocol + '//' + window.location.hostname;

        if (window.location.port) this.origin += ':' + window.location.port;
    }

    this.buttonRefresh.click(function (event) {
        that.confirmDialog.modal('show');
    });

    this.confirmDialogButtonOk.click(function () {
        that.confirmDialog.modal('hide');

        superagent.post('/api/v1/apps/0/generate').withCredentials().query({ userToken: $.cookie('userToken') }).end(function (error, result) {
            if (error || !result.ok) {
                console.error('Failed to get details.', error);
                return;
            }

            that.fillForm(result.body.appKey, result.body.appSecret);
        });
    });

    this.confirmDialogButtonCancel.click(function (event) {
        that.confirmDialog.modal('hide');
    });
}

ApplicationFragment.prototype.show = function () {
    this.container.show();
    this.context.navbar.buttonSignup.hide();
    this.context.navbar.buttonLogout.show();
    this.context.navbar.buttonLogin.hide();
    this.context.navbar.buttonDeleteAccount.show();
};

ApplicationFragment.prototype.hide = function () {
    this.container.hide();
};

ApplicationFragment.prototype.fillForm = function (appKey, appSecret) {
    this.inputAppKey.val(appKey);
    this.inputAppKey.click(function () { $(this).select(); });
    this.inputAppSecret.val(appSecret);
    this.inputAppSecret.click(function () { $(this).select(); });
    this.inputCallbackUrl.text(this.origin + '/proxy/' + appKey + '/');
    this.inputCallbackUrl.attr('href', this.origin + '/proxy/' + appKey + '/');

    this.usageAppKeyLabel.text(appKey);
    this.usageAppSecretLabel.text(appSecret);
    this.usageRemoteLabel.text(this.origin);
    this.usageExampleUrlLabel.text(this.origin + '/proxy/' + appKey + '/test/route');
};



// some global helpers
function getApplicationDetails(callback) {
    superagent.post('/api/v1/apps/0/details').withCredentials().query({ userToken: $.cookie('userToken') }).end(function (error, result) {
        if (error || !result.ok) {
            return callback(error ? error : result.status);
        }

        callback(null, result.body);
    });
}

function showFragment(fragment) {
    for (var frag in context.fragments) {
        if (context.fragments.hasOwnProperty(frag)) {
            context.fragments[frag].hide();
        }
    }

    fragment.show();
}

function init() {
    context.navbar = new NavbarFragment(context);
    context.fragments.welcome = new WelcomeFragment(context);
    context.fragments.login = new LoginFragment(context);
    context.fragments.signup = new SignupFragment(context);
    context.fragments.application = new ApplicationFragment(context);

    // figure out if we have a session and then carry on
    if ($.cookie('userToken')) {
        getApplicationDetails(function (error, result) {
            if (error) {
                console.error('Failed to get details.', error);
                showFragment(context.fragments.welcome);
                return;
            }

            context.fragments.application.fillForm(result.appKey, result.appSecret);
            showFragment(context.fragments.application);
        });
    } else {
        showFragment(context.fragments.welcome);
    }
}

window.addEventListener('load', init);
