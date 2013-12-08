#!/usr/bin/env node

'use strict';

var request = require('superagent'),
    debug = require('debug')('client'),
    commander = require('commander');

commander.version('0.1.0')
    .option('-s, --server [url]', 'Remote callback server.')
    .option('-k, --key <appkey>', 'Application key to be recongnized by the callback server.')
    .option('-p, --payload [payload]', 'Specifies an additional payload for the "test" commands.')
    .option('refresh', 'Get a new the application key.')
    .option('test <route>', 'Tests a callback route.')
    .option('listen [url]', 'Listen and waits for callbacks and dispatches them locally. Default to http://localhost:3000.')
    .parse(process.argv);


/*
 * some global configs
 */
var server = commander.server || 'http://localhost:3001';
debug('Using remote callback server %s', server);
var listener = typeof commander.listen === 'string' ? commander.listen : 'http://localhost:3000';
debug('Using %s to dispatch incoming requests locally.', listener);
var user = 'dummy';
debug('Using user api token %s.', user);
var appKey = commander.key;
debug('Using app key "%s".', appKey);


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

    request.get(server + '/appkey').end(function (error, result) {
        if (error) {
            console.error('Unable to reach the server.', error);
            return;
        }

        console.log(result.body.appkey);
    });
}

function listen() {
    debug('Listen for callbacks to dispatch.');

    var socket = require('socket.io-client').connect(server);
    socket.on('connect', function () {
        console.log('Connected to server...');
    });

    socket.on('callback', function (data) {
        console.log('Received callback, dispatch further.', data);
    });

    socket.on('disconnect', function () {
        console.log('Disconnected from server. Exit.');
        process.exit(1);
    });

    socket.emit('auth', appKey);
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
