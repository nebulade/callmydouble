#!/usr/bin/env node

'use strict';

var server = require('./lib/index');

server.start({}, function (error, result) {
    if (error) {
        console.error('Unable to start server.', error);
        process.exit(1);
    }

    console.log('Server is running and it is a steady listener on port ' + result.port);
});
