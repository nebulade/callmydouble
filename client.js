#!/usr/bin/env node

'use strict';

var request = require('superagent'),
    debug = require('debug')('client'),
    Listener = require('./lib/listener'),
    commander = require('commander');

commander.version('0.1.0')
    .option('-s, --server [url]', 'Remote callback server.')
    .option('-p, --payload [payload]', 'Specifies an additional payload for the "test" commands.')
    .option('-a, --accessToken <access token>', 'Specifies the access token used to authenticate with the server.')
    .option('refresh', 'Get a new the application key.')
    .option('test <route>', 'Tests a callback route.')
    .option('listen <application key>', 'Listen and waits for callbacks based on the application key.')
    .parse(process.argv);


/*
 * some global configs
 */
var server = commander.server || 'http://localhost:3001';
debug('Using remote callback server %s', server);
var listener = typeof commander.listen === 'string' ? commander.listen : 'http://localhost:3000';
debug('Using %s to dispatch incoming requests locally.', listener);
var accessToken = commander.accessToken || 'dummy';
debug('Using accessToken "%s".', accessToken);
var appKey = commander.listen;
if (appKey) debug('Using app key "%s".', appKey);


/*
 * actual functionality
 */
function test(route) {
    debug('Test callback', commander.test);

    request.post(server + '/proxy/' + appKey + '/' + route).end(function (error, result) {
        if (error) {
            console.error('Unable to reach the server.', error);
            return;
        }

        console.log('Sent callback to %s. Status: %s', server, result.status);
    });
}

function refresh() {
    debug('Refresh callback');

    request.get(server + '/appkey').query({'access_token': accessToken}).end(function (error, result) {
        if (error) {
            console.error('Unable to reach the server.', error);
            return;
        }

        console.log(result.body.appkey);
    });
}

function listen() {
    listener = new Listener(server, accessToken);

    listener.on('connect', function () {
        debug('Connected to server "%s".', server);
    });
    listener.on('disconnect', function () {
        debug('Disconnected from server "%s".', server);
    });
    listener.on('callback', function (data) {
        debug('Received callback.');
        console.log(data);
    });

    listener.start();
}


/*
 * Main program flow starts here
 */
if (commander.test) {
    test(commander.test);
} else if (commander.listen) {
    listen();
} else if (commander.refresh) {
    refresh();
} else {
    commander.help();
}
