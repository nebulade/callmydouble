'use strict';

var express = require('express'),
    http = require('http'),
    crypto = require('crypto'),
    once = require('once'),
    url = require('url'),
    path = require('path'),
    uuid = require('uuid'),
    redis = require('redis'),
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
    var shasum = crypto.createHash('sha1');
    shasum.update(key + secret);
    return shasum.digest('hex');
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

function extractCredentialsFromHeaders(req) {
    if (!req.headers || !req.headers.authorization) {
        debug('No authorization header.');
        return null;
    }

    if (req.headers.authorization.substr(0, 6) !== 'Basic ') {
        debug('Only basic authorization supported.');
        return null;
    }

    var b = new Buffer(req.headers.authorization.substr(6), 'base64');
    var s = b.toString('utf8');
    if (!s) {
        debug('Authorization header does not contain a valid string.');
        return null;
    }

    var a = s.split(':');
    if (a.length != 2) {
        debug('Authorization header does not contain a valid username:password tuple.');
        return null;
    }

    return {
        user: a[0],
        password: a[1]
    };
}

// TODO use headers instead of query
function authentication(req, res, next) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided.');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);

        if (!result || !result.exists || !result.valid) {
            return res.send(401);
        }

        req.user = auth.user;
        next();
    });
}

function verify(user, password, callback) {
    store.get(user, function (error, result) {
        var resultObj;

        if (error) {
            debug('Failed to get user record.', error);
            return callback(error);
        }

        if (!result) {
            debug('No such user "%s".', user);
            return callback(null, { exists: false, valid: false });
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            return callback(e);
        }

        if (resultObj.password !== password) {
            debug('Invalid password for uer "%s".', user);
            return callback(null, { exists: true, valid: false });
        }

        return callback(null, {exists: true, valid: true });
    });
}

function usersSignin(req, res, next) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided.');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);

        if (!result.exists) {
            debug('No such record, create user "%s".', auth.user);

            var key = generateAppKey();
            var secret = generateAppSecret();

            var userObj = {
                email: auth.user,
                password: auth.password
            };
            userObj[APPKEY_KEY] = key;
            userObj[APPSECRET_KEY] = secret;

            store.set(auth.user, JSON.stringify(userObj));
            store.set(key, auth.user);
            store.set(hashKeyWithSecret(key, secret), auth.user);

            debug('Application key for user %s successfully updated. Hash key "%s".', auth.user, hashKeyWithSecret(key, secret));
            res.send(201);
        } else if (result.exists && result.valid) {
            return res.send(200);
        } else {
            return res.send(401);
        }
    });
}

function appsDetails(req, res, next) {
    store.get(req.user, function (error, result) {
        var resultObj;

        if (error) {
            debug('Failed to get app details from store.');
            return res.send(500);
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            debug('Unable to parse app details.', e);
            return res.send(500);
        }

        res.send(200, resultObj);
    });
}

function appsGenerate(req, res, next) {
    var key = generateAppKey();
    var secret = generateAppSecret();

    store.get(req.user, function (error, result) {
        var resultObj;

        if (error || !result) {
            debug('Failed to get the app key for user "%s".', req.user);
            return res.send(500);
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            debug('Unable to parse app details.', e);
            return res.send(500);
        }

        resultObj[APPKEY_KEY] = key;
        resultObj[APPSECRET_KEY] = secret;
        store.set(req.user, JSON.stringify(resultObj));
        store.set(key, req.user);
        store.set(hashKeyWithSecret(key, secret), req.user);

        debug('Application key for user %s successfully updated. Hash key "%s".', req.user, hashKeyWithSecret(key, secret));
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

            store.get(user, function (error, result) {
                var resultObj;

                if (error || !result) {
                    debug('No application key associated for user "%s".', user);
                    return;
                }

                try {
                    resultObj = JSON.parse(result);
                } catch (e) {
                    debug('Unable to parse app details.', e);
                    return;
                }

                appKey = resultObj[APPKEY_KEY];
                debug('Client %s uses application key "%s".', user, appKey);

                var redisClient = createRedisClient();
                redisClient.on('subscribe', function (channel, count) {
                    console.log('Subscribed to channel %s with count %s', channel, count);
                });
                redisClient.on('message', function (channel, message) {
                    console.log('Message on channel %s with message %s', channel, message);
                    if (!listeners[channel]) {
                        debug('Even though we listen for that appkey we do not have a listener attached.');
                        return;
                    }

                    var obj;
                    try {
                        obj = JSON.parse(message);
                    } catch (e) {
                        debug('Unable to parse message from channel.', e);
                        return;
                    }

                    listeners[channel].socket.emit('callback', obj);
                });
                redisClient.subscribe(appKey);

                listeners[appKey] = { socket: socket, redis: redisClient };
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

    var user = store.get(req.params.appKey);
    if (!user) {
        debug('Appkey "%s" unknown.', req.params.appKey);
        return res.send(404);
    }

    var callbackObject = {
        route: '/' + req.params[0],
        payload: req.body || req.statusText,
        method: req.method
    };

    if (!listeners[req.params.appKey]) {
        debug('No listener for this user. Publish for potential other customers.');
        try {
            store.publish(req.params.appKey, JSON.stringify(callbackObject));
        } catch (e) {
            debug('Stringify callback object failed.', e);
        }
    } else {
        debug('Proxy callback route "%s" for user %s.', req.params[0], user);
        listeners[req.params.appKey].socket.emit('callback', callbackObject);
    }

    res.send(200);
}

function createRedisClient() {
    var client;

    // REDISTOGO_URL is set when running inside heroku
    if (process.env.REDISTOGO_URL) {
        var rtg = url.parse(process.env.REDISTOGO_URL);
        client = redis.createClient(rtg.port, rtg.hostname);
        client.auth(rtg.auth.split(':')[1]);
    } else {
        client = redis.createClient();
    }

    client.on("error", function (error) {
        console.error("error event - " + client.host + ":" + client.port + " - " + error);
    });

    return client;
}

function allowCrossDomain(req, res, next) {
    res.header('Access-Control-Allow-Origin', process.env.ORIGIN ? process.env.ORIGIN : 'http://callmydouble.nebulon.de');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, Accept, Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');

    // intercept OPTIONS method
    if ('OPTIONS' == req.method) {
        res.send(200);
    } else {
        next();
    }
}

function start(options, callback) {
    assert(typeof options === 'object');
    assert(typeof callback === 'function');

    store = createRedisClient();
    store.on('error', function (error) {
        console.error(error);
        console.error('Failed to connect to redis, is it running?');
        process.exit(1);
    });

    app = express();
    app.use(express.logger());
    app.use(express.compress());
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(allowCrossDomain);
    app.use(app.router);

    app.post('/api/v1/users/signin', usersSignin);
    app.post('/api/v1/apps/:appid/details', authentication, appsDetails);
    app.post('/api/v1/apps/:appid/generate', authentication, appsGenerate);
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
