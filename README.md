callmydouble
============

*under heavy development*

Usage
-----

This project is npm based, so `npm install` gets you all the dependencies.

To start the publicly available beach head which dispatches incoming POSTs forward to the user's client you need to have a redis server running.
```
DEBUG=* ./server.js
```

Back on your developer box, you have to obtain an application key. Each user can get initially and refresh his application key.
This key can then be used to create a unique callback route which will get disptached to the listener which passes the same application
key in. If the server is not running on the same machine, all client commands will take a --server option to specify the remote server.
```
./client.js refresh 'dummy'
DEBUG=* ./client.js listen --key <appkey> --secret <appsecret>
```

From that point on you can test the flow
```
export APPKEY=<appkey>
curl -X POST http://localhost:3001/proxy/$APPKEY/foobar -H "Content-Type: application/json" -d '{"something":"to","say":true}'
```

The `test` command also takes the `--payload` and the `--method` commandline argument to further test different REST methods with message bodies.

Currently the user handling is missing and only a dummy user is used per default.