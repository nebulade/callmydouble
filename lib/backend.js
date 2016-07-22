'use strict';

var express = require('express'),
    http = require('http'),
    crypto = require('crypto'),
    once = require('once'),
    url = require('url'),
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
var singleton = false;

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

function generateUserToken() {
    var token = 't-' + uuid.v4();
    debug('Generated a new user token "%s".', token);
    return token;
}

function hashKeyWithSecret(key, secret) {
    var shasum = crypto.createHash('sha1');
    shasum.update(key + secret);
    return shasum.digest('hex');
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

function extractUserTokenFromQuery(req) {
    if (!req.query || !req.query.userToken) {
        debug('No authorization token provided.');
        return null;
    }

    return req.query.userToken;
}

function authentication(req, res, next) {
    var auth = extractCredentialsFromHeaders(req);
    var userToken = extractUserTokenFromQuery(req);

    function verificationCallback(error, result) {
        if (error) return res.send(500);

        if (!result || !result.exists || !result.valid) {
            return res.send(401);
        }

        debug('User %s successfully authenticated.', result.data.user);

        req.user = result.data.user;
        next();
    }

    if (auth) return verify(auth.user, auth.password, verificationCallback);
    if (userToken) return verifyUserToken(userToken, verificationCallback);

    debug('No token or auth header provided.');
    res.send(401);
}

function verifyUserToken(userToken, callback) {
    store.get(userToken, function (error, user) {
        if (error) {
            debug('Failed to get record for userToken.', error);
            return callback(error);
        }

        if (!user) {
            debug('Invalid userToken.');
            return callback(null, { exists: false, valid: false, data: null });
        }

        store.get(user, function (error, result) {
            var resultObj;

            if (error) {
                debug('Failed to get user record.', error);
                return callback(error);
            }

            if (!result) {
                debug('No such user "%s".', user);
                return callback(null, { exists: false, valid: false, data: null });
            }

            try {
                resultObj = JSON.parse(result);
            } catch (e) {
                return callback(e);
            }

            return callback(null, { exists: true, valid: true, data: resultObj });
        });
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
            return callback(null, { exists: false, valid: false, data: null });
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            return callback(e);
        }

        if (resultObj.password !== password) {
            debug('Invalid password for user "%s".', user);
            return callback(null, { exists: true, valid: false, data: null });
        }

        return callback(null, { exists: true, valid: true, data: resultObj });
    });
}

function generateAndStoreNewDetails(user, password, callback) {
    var key = generateAppKey();
    var secret = generateAppSecret();
    var keyHash = hashKeyWithSecret(key, secret);
    var userToken = generateUserToken();

    var data = {};
    data.user = user;
    data.email = user;
    data.password = password;
    data.userToken = userToken;
    data[APPKEY_KEY] = key;
    data[APPSECRET_KEY] = secret;

    store.set(user, JSON.stringify(data));
    store.set(key, user);
    store.set(keyHash, user);
    store.set(userToken, user);

    debug('Application key for user %s successfully updated. Hash key "%s".', user, keyHash);

    callback(null, { appKey: key, appSecret: secret, userToken: userToken });
}

function login(req, res) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);

        if (!result.exists) {
            debug('No such record.');
            return res.send(401);
        } else if (!result.valid) {
            debug('Invalid credentials.');
            return res.send(401);
        }

        var userToken = generateUserToken();
        result.data.userToken = userToken;
        store.set(auth.user, JSON.stringify(result.data));
        store.set(userToken, auth.user);

        res.send(200, { userToken: userToken });
    });
}

function logout(req, res) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);

        if (!result.exists || !result.valid) {
            debug('User does not exists or credentials are invalid.');
            return res.send(401);
        }

        result.data.userToken = null;
        store.set(auth.user, JSON.stringify(result.data));

        res.send(200);
    });
}

function signup(req, res) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);

        if (result.exists) {
            debug('User already exists.');
            return res.send(409);
        }

        debug('Create new user "%s".', auth.user);
        generateAndStoreNewDetails(auth.user, auth.password, function (error, result) {
            if (error) {
                console.error('Unable to generate and store new user details');
                return res.send(500);
            }

            res.send(201, result);
        });
    });
}

function signoff(req, res) {
    store.get(req.user, function (error, result) {
        var resultObj;

        if (error) {
            console.error('Failed to get app details from store.');
            return res.send(500);
        }

        if (!result) {
            console.error('No entry for that user.');
            return res.send(500);
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            console.error('Unable to parse app details.', e);
            return res.send(500);
        }

        var key = resultObj[APPKEY_KEY];
        var secret = resultObj[APPSECRET_KEY];
        var keyHash = hashKeyWithSecret(key, secret);

        debug('Delete', key, secret, req.user);

        store.del([keyHash, key, req.user, result.userToken], function (error) {
            if (error) {
                console.error('Failed to delete user.', error);
                return res.send(500);
            }

            debug('User %s successfully deleted.', req.user);
            res.send(200);
        });
    });
}

function appsDetails(req, res) {
    store.get(req.user, function (error, result) {
        var resultObj;

        if (error) {
            console.error('Failed to get app details from store.');
            return res.send(500);
        }

        if (!result) {
            console.error('No entry for that user.');
            return res.send(500);
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            console.error('Unable to parse app details.', e);
            return res.send(500);
        }

        res.send(200, resultObj);
    });
}

function appsGenerate(req, res) {
    store.get(req.user, function (error, result) {
        var resultObj;

        if (error || !result) {
            console.error('Failed to get the app key for user "%s".', req.user);
            return res.send(500);
        }

        try {
            resultObj = JSON.parse(result);
        } catch (e) {
            console.error('Unable to parse app details.', e);
            return res.send(500);
        }

        generateAndStoreNewDetails(req.user, resultObj.password, function (error, result) {
            if (error) {
                console.error('Unable to generate and store new user details');
                return res.send(500);
            }

            res.send(201, { appKey: result.appKey, appSecret: result.appSecret });
        });
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
                    console.error('Unable to parse app details.', e);
                    socket.emit('auth', false);
                    return;
                }

                appKey = resultObj[APPKEY_KEY];
                debug('Client %s uses application key "%s".', user, appKey);

                if (!singleton) {
                    debug('Not using singleton mode, so register a redis listener for client.');
                    var redisClient = createRedisClient();
                    redisClient.on('subscribe', function (channel, count) {
                        debug('Subscribed to channel %s with count %s', channel, count);
                    });
                    redisClient.on('message', function (channel, message) {
                        debug('Message on channel %s with message %s', channel, message);
                        if (!listeners[channel]) {
                            debug('Even though we listen for that appkey we do not have a listener attached.');
                            return;
                        }

                        var obj;
                        try {
                            obj = JSON.parse(message);
                        } catch (e) {
                            console.error('Unable to parse message from channel.', e);
                            return;
                        }

                        listeners[channel].socket.emit('callback', obj);
                    });
                    redisClient.subscribe(appKey);

                    listeners[appKey] = { socket: socket, redis: redisClient };
                } else {
                    debug('Using singleton mode, no need to register a redis listener for client.');
                    listeners[appKey] = { socket: socket, redis: null };
                }

                socket.emit('auth', true);
            });
        });
    });

    socket.on('disconnect', function () {
        debug('Client %s disconnects.', appKey);
        delete listeners[appKey];
    });
}

function proxy(req, res) {
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
        store.publish(req.params.appKey, JSON.stringify(callbackObject));
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

    singleton = options.singleton || false;

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

    app.post('/api/v1/users/login', login);
    app.post('/api/v1/users/logout', logout);
    app.post('/api/v1/users/signup', signup);
    app.post('/api/v1/users/signoff', authentication, signoff);
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
