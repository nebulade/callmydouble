'use strict';

var debug = require('debug')('listener'),
    events = require('events'),
    crypto = require('crypto'),
    util = require('util');

exports = module.exports = Listener;

function Listener(server, appKey, appSecret) {
    events.EventEmitter.call(this);

    this._socket = null;

    this._server = server;
    this._appKey = appKey;
    this._appSecret = appSecret;

    // Avoid exception when no error handler is attached
    this.on('error', function (error) {
        debug('Unable to connect Socket.IO', error);
    });
}
util.inherits(Listener, events.EventEmitter);

Listener.prototype._hashKeyWithSecret = function (key, secret) {
    var shasum = crypto.createHash('sha1');
    shasum.update(key + secret);
    return shasum.digest('hex');
};

Listener.prototype.start = function () {
    var that = this;

    debug('Listen for callbacks to dispatch.', that._appKey, that._appSecret, that._hashKeyWithSecret(that._appKey, that._appSecret));

    this._socket = require('socket.io-client').connect(this._server);
    this._socket.on('connect', function () {
        debug('Connected to server...send auth token.');
        that._socket.emit('access_token', that._hashKeyWithSecret(that._appKey, that._appSecret));

        that.emit('connect');
    });

    this._socket.on('error', function (error) {
        that.emit('error', error);
    });

    this._socket.on('auth', function (status) {
        if (status) debug('Authentication with access_token succeeded.');
        else debug('Authentication with access_token failed.');
        that.emit('auth', status);
    });

    this._socket.on('callback', function (data) {
        debug('Received callback, dispatch further.', data);
        that.emit('callback', data);
    });

    this._socket.on('disconnect', function () {
        debug('Disconnected from server. Exit.');
        that.emit('disconnect');
    });
};

Listener.prototype.stop = function () {
    if (!this._socket) {
        debug('No socket created.');
        return;
    }

    this._socket.close();
};