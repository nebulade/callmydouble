#!/usr/bin/env node

'use strict';

var request = require('superagent'),
    debug = require('debug')('client'),
    commander = require('commander');

commander.version('0.1.0')
    .option('add <route>', 'Add a new callback handler.')
    .option('remove <route>', 'Removes a callback handler.')
    .option('test <route>', 'Tests a callback handler.')
    .option('listen [url]', 'Listen and waits for callbacks and dispatches them locally. Default to http://localhost:3000.')
    .option('-s, --server [url]', 'Remote callback server.')
    .parse(process.argv);


/*
 * some global configs
 */
var server = commander.server || 'http://localhost:3001';
debug('Using remote callback server %s', server);
var listener = typeof commander.listen === 'string' ? commander.listen : 'http://localhost:3000';
debug('Using %s to dispatch incoming requests locally.', listener);
var userApiToken = 'dummy';
debug('Using user api token %s.', userApiToken);

/*
 * program entry points
 */
function add(route) {
    debug('Add callback', commander.add);

}

function remove(route) {
    debug('Remove callback', commander.remove);

}

function test(route) {
    debug('Test callback', commander.test);

    request.post(server + '/proxy/' + userApiToken + '/' + route).end(function (error, result) {
        if (error) {
            console.error('Unable to reach the server.', error);
            return;
        }

        console.log('Sent callback to %s. Status: %s', server, result.status);
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

    socket.emit('auth', 'dummy');
}


/*
 * Main program flow starts here
 */
if (commander.add) {
    add(commander.add);
} else if (commander.remove) {
    remove(commander.remove);
} else if (commander.test) {
    test(commander.test);
} else if (commander.listen) {
    listen();
} else {
    commander.help();
}
