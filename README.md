callmydouble
============

*under heavy development*

Usage
-----

This project is npm based, so `npm install` gets you all the dependencies.

To start the publicly available beach head which dispatches incoming POSTs forward to the user's client you need to have a redis server running.
```
./server.js
```

Back on your developer box, you have to obtain an application key. Each user can get initially and refresh his application key.
This key can then be used to create a unique callback route which will get disptached to the listener which passes the same application
key in. If the server is not running on the same machine, all client commands will take a --server option to specify the remote server.
```
APPKEY=`./client.js refresh`
./client.js listen --key $APPKEY
```

From that point on you can test the flow
```
./client.js test /please/call/me/back --key $APPKEY
```

The `test` command also takes the `--payload` and the `--method` commandline argument to further test different REST methods with message bodies.

Currently the user handling is missing and only a dummy user is used per default.