'use strict';

var express = require('express'),
    http = require('http'),
    once = require('once'),
    debug = require('debug')('server'),
    assert = require('assert'),
    callbacks = require('./callbacks');

exports = module.exports = {
    start: start,
    stop: stop
};

var app, io;
var listeners = {};

function handleListener(socket) {
    var authToken;

    socket.on('auth', function (token) {
        if (authToken) {
            debug('Client already sent authentication');
            return;
        }

        if (token === 'dummy') {
            debug('Client %s connected.', token);
            authToken = token;
            listeners[authToken] = socket;
        }
    });

    socket.on('disconnect', function () {
        debug('Client %s disconnects.', authToken);
        delete listeners[authToken];
    });
}

function proxy(req, res, next) {
    console.log(req.params);

    if (!req.params || !req.params.userApiToken) {
        debug('Request invalid, misses userApiToken.');
        return res.send(400);
    }

    if (!listeners[req.params.userApiToken]) {
        debug('No listener for this user.');
        return res.send(401);
    }

    debug('Proxy callback %s for user %s.', req.params[0], req.params.userApiToken);
    listeners[req.params.userApiToken].emit('callback', req.params[0]);
}

function start(options, callback) {
    assert(typeof options === 'object');
    assert(typeof callback === 'function');


    var callbackOnce = once(function (error) {
        if (error) return callback(error);
        callback(null, app.server.address());
    });

    app = express();
    app.use(express.logger());
    app.use(express.compress());
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(app.router);

    app.post('/callbacks', callbacks.create);
    app.get('/callbacks', callbacks.list);
    app.get('/callbacks/:callback', callbacks.get);
    app.delete('/callbacks/:callback', callbacks.remove);

    app.post('/proxy/:userApiToken/*', proxy);

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
