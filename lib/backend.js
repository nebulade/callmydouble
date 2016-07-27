'use strict';

var express = require('express'),
    http = require('http'),
    crypto = require('crypto'),
    once = require('once'),
    url = require('url'),
    uuid = require('uuid'),
    redis = require('redis'),
    debug = require('debug')('server'),
    assert = require('assert'),
    superagent = require('superagent'),
    serveStatic = require('serve-static');

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

function extractCredentialsFromHeaders(req) {
    if (!req.headers || !req.headers.authorization) return null;

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
    if (!req.query || !req.query.userToken) return null;

    return req.query.userToken;
}

function authentication(req, res, next) {
    var auth = extractCredentialsFromHeaders(req);
    var userToken = extractUserTokenFromQuery(req);

    function verificationCallback(error, result) {
        if (error) return res.send(500);
        if (!result) return res.send(401);

        debug('User %s successfully authenticated.', result.user);

        req.user = result.user;
        req.accessToken = result.accessToken;

        next();
    }

    if (auth) return verify(auth.user, auth.password, verificationCallback);
    if (userToken) return verifyUserToken(userToken, verificationCallback);

    debug('No token or auth header provided.');

    res.send(401);
}

function verifyUserToken(userToken, callback) {
    superagent.get(process.env.API_ORIGIN + '/api/v1/profile').query({ access_token: userToken }).end(function (error, result) {
        if (error && error.status === 401) return callback(null, null);
        if (error) return callback(error);

        debug('Verifying token successful', result.body);

        callback(null, { user: result.body.username });
    });
}

function verify(user, password, callback) {
    var authPayload = {
        clientId: process.env.SIMPLE_AUTH_CLIENT_ID,
        username: user,
        password: password
    };

    superagent.post(process.env.SIMPLE_AUTH_URL + '/api/v1/login').send(authPayload).end(function (error, result) {
        if (error && error.status === 401) return callback(null, null);
        if (error) return callback(error);
        if (result.status !== 200) return callback(null, null);

        debug('Login successful', result.body);

        callback(null, {
            user: result.body.user.id,
            accessToken: result.body.accessToken
        });
    });
}

function generateAndStoreNewDetails(user, password, callback) {
    var key = generateAppKey();
    var secret = generateAppSecret();
    var keyHash = hashKeyWithSecret(key, secret);

    var data = {};
    data.user = user;
    data.email = user;

    data[APPKEY_KEY] = key;
    data[APPSECRET_KEY] = secret;

    store.set(user, JSON.stringify(data));
    store.set(key, user);
    store.set(keyHash, user);

    debug('Application key for user %s successfully updated. Hash key "%s".', user, keyHash);

    callback(null, { appKey: key, appSecret: secret, userToken: data.userToken || null });
}

function login(req, res) {
    var auth = extractCredentialsFromHeaders(req);
    if (!auth) {
        debug('No or invalid auth header provided');
        res.send(401);
    }

    verify(auth.user, auth.password, function (error, result) {
        if (error) return res.send(500);
        if (!result) return res.send(401);

        res.send(200, { userToken: result.ccessToken });
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
        if (!result) return res.send(401);

        // TODO perform logout

        res.send(200);
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
            console.error('No entry for that user. Creating default');
            return appsGenerate(req, res);
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

        if (error) {
            console.error('Failed to get the app key for user "%s".', req.user);
            return res.send(500);
        }

        if (!result) {
            resultObj = {};
        } else {
            try {
                resultObj = JSON.parse(result);
            } catch (e) {
                console.error('Unable to parse app details.', e);
                return res.send(500);
            }
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

                listeners[appKey] = { socket: socket };

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

    // REDISTOGO_URL is set when running inside heroku or Cloudron
    if (process.env.REDISTOGO_URL || process.env.REDIS_URL) {
        var rtg = url.parse(process.env.REDISTOGO_URL || process.env.REDIS_URL);
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
    app.use(serveStatic(__dirname + '/../public', { etag: false }));
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(allowCrossDomain);
    app.use(app.router);

    app.post('/api/v1/users/login', login);
    app.post('/api/v1/users/logout', logout);
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
