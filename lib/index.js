'use strict';

var express = require('express'),
    http = require('http'),
    once = require('once'),
    redis = require('redis'),
    uuid = require('uuid'),
    debug = require('debug')('server'),
    assert = require('assert');

exports = module.exports = {
    start: start,
    stop: stop
};

var app, io, store;
var listeners = {};

var APPKEY_KEY = 'appKey';
var APPSECRET_KEY = 'appSecret';

function generateAppKey() {
    var key = 'k-' + uuid.v4();
    debug('Generated a new application key "%s".', key);
    return key;
}

function generateAppSecret() {
    var secret = 's-' + uuid.v4();
    debug('Generated a new application secret "%s".', secret);
    return secret;
}

function hashKeyWithSecret(key, secret) {
    return key + secret;
}

function verifyKeyWithSecret(user, key, secret, callback) {
    debug('Verifying key "%s" with secret "%s".', key, secret);

    store.get(user, function (error, result) {
        if (error || !result) {
            debug('Unable to verify, no such user entry.');
            return callback(new Error('No such user entry'));
        }

        if (hashKeyWithSecret(user[APPKEY_KEY], user[APPSECRET_KEY]) !== hashKeyWithSecret(key, secret)) {
            debug('Key/Secret verification failed.');
            return callback(new Error('Verification failed'));
        }

        callback();
    });
}

// TODO use headers instead of query
function authentication(req, res, next) {
    if (!req.query.access_token) {
        debug('Request does not contain an access token.');
        return res.send(401, 'No access token.');
    }

    // plug in real token verification here
    req.user = req.query.access_token;
    next();
}

function credentials(req, res, next) {
    var key = generateAppKey();
    var secret = generateAppSecret();

    store.hget(req.user, APPKEY_KEY, function (error, result) {
        if (error || !result) {
            debug('Failed to get the app key for user "%s".', req.user);
        } else {
            // remove entry for old appkey
            debug('Clearing old application key for user "%s".', req.user);
            store.del(result);
        }

        store.hset(req.user, APPKEY_KEY, key);
        store.hset(req.user, APPSECRET_KEY, secret);
        store.set(key, req.user);
        store.set(hashKeyWithSecret(key, secret), req.user);

        debug('Application key for user %s successfully updated.', req.user);
        res.send(201, { appKey: key, appSecret: secret });
    });
}

function handleListener(socket) {
    var appKey;

    socket.on('access_token', function (token) {
        if (appKey) {
            debug('Client already sent authentication');
            return;
        }

        debug('Client %s connected.', token);
        store.get(token, function (error, user) {
            if (error || !user) {
                debug('Invalid token "%s" from client.', token);
                socket.emit('auth', false);
                return;
            }

            store.hget(user, APPKEY_KEY, function (error, result) {
                if (error || !result) {
                    debug('No application key associated for user "%s".', result);
                    return;
                }

                appKey = result;
                debug('Client %s uses application key "%s".', user, appKey);
                listeners[appKey] = socket;
                socket.emit('auth', true);
            });
        });
    });

    socket.on('disconnect', function () {
        debug('Client %s disconnects.', appKey);
        delete listeners[appKey];
    });
}

function proxy(req, res, next) {
    debug('Try to proxy request', req.params);

    if (!req.params || !req.params.appKey) {
        debug('Request invalid, misses appKey.');
        return res.send(400);
    }

    if (!listeners[req.params.appKey]) {
        debug('No listener for this user.');
        return res.send(404);
    }

    var user = store.get(req.params.appKey);
    if (!user) {
        debug('Appkey "%s" unknown.', req.params.appKey);
        return res.send(404);
    }

    debug('Proxy callback route "%s" for user %s.', req.params[0], user);
    listeners[req.params.appKey].emit('callback', { route: '/' + req.params[0], payload: req.body || req.statusText, method: req.method });

    res.send(200);
}

function start(options, callback) {
    assert(typeof options === 'object');
    assert(typeof callback === 'function');

    store = redis.createClient();
    store.on("error", function (error) {
        console.error(error);
        console.error('Failed to connect to redis, is it running?');
        process.exit(1);
    });

    app = express();
    app.use(express.logger());
    app.use(express.compress());
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(app.router);

    app.get('/credentials', authentication, credentials);
    app.all('/proxy/:appKey/*', proxy);

    var callbackOnce = once(function (error) {
        if (error) return callback(error);
        callback(null, app.server.address());
    });

    app.server = http.createServer(app).listen(options.port || 3001);
    app.server.on('error', callbackOnce);
    app.server.on('listening', callbackOnce);

    io = require('socket.io').listen(app.server);
    io.sockets.on('connection', handleListener);
}

function stop(callback) {
    assert(typeof callback === 'function');

    callback();
}
