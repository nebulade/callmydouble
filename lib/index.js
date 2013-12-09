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

function generateAppKey() {
    var key = uuid.v4();
    debug('Generated a new appkey "%s".', key);
    return key;
}

function authentication(req, res, next) {
    req.user = 'dummy';
    next();
}

function appkey(req, res, next) {
    var key = generateAppKey();

    var oldAppKey = store.hget(req.user, 'appkey');
    if (!oldAppKey) {
        debug('Failed to get the app key for user %s.', req.user);
    } else {
        store.del(oldAppKey);
    }

    store.hset(req.user, 'appkey', key);
    store.set(key, req.user);

    debug('App key for user %s successfully updated.', req.user);
    res.send(201, { appkey: key });
}

function handleListener(socket) {
    var appKey;

    socket.on('auth', function (token) {
        if (appKey) {
            debug('Client already sent authentication');
            return;
        }

        debug('Client %s connected.', token);
        appKey = token;
        listeners[appKey] = socket;
    });

    socket.on('disconnect', function () {
        debug('Client %s disconnects.', appKey);
        delete listeners[appKey];
    });
}

function proxy(req, res, next) {
    console.log(req.params);

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
    listeners[req.params.appKey].emit('callback', { route: req.params[0], payload: req.statusText, method: req.method });
}

function start(options, callback) {
    assert(typeof options === 'object');
    assert(typeof callback === 'function');

    store = redis.createClient();
    store.on("error", function (error) {
        console.error('Failed to connect to redis, is it running?', error);
        process.exit(1);
    });

    app = express();
    app.use(express.logger());
    app.use(express.compress());
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(app.router);

    app.get('/appkey', authentication, appkey);
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
