callmydouble
============

Note: There might be thousands such solutions available already! :D

Ever needed a public beach head to catch callbacks from third party services, but you wanna react locally?

This module provides a simple server, which can be run on a publicly reachable servers,
allowing clients to connect via socket.io from their developer box to the server.
The client maintains a connection and will get notified if the public server was called on a
user specific URL.

The server can maintain multiple such developer connections and give each of them a unique
callback URL, which will get dispatched to their local client, where the developer is free to
do whatever he wants with it.

The bundled `client` allows to generate application keys to identify the user and specify the unique URL.
It further is an example on how to use the `Listener` in your application.
The most common use case might be to just forward the incoming request locally to a node during development.

Installation
------------

This project is npm based, so `npm install` gets you most the dependencies.
For a backing store, the `server` uses redis. So you need to provide a redis instance.

If redis is locally installed, just run `redis-server`.

Usage
-----

To start the publicly available beach head which dispatches incoming POSTs forward to the user's client you need to have a redis server running.
```
DEBUG=* ./bin/server
```

Back on your developer box, you have to obtain an application key. Each user can get initially and refresh his application key.
This key can then be used to create a unique callback route which will get disptached to the listener which passes the same application
key in. If the server is not running on the same machine, all client commands will take a --server option to specify the remote server.
```
./bin/client refresh 'unicorn'
DEBUG=* ./bin/client listen --key <appkey> --secret <appsecret>
```

From that point on you can test the flow
```
export APPKEY=<appkey>
curl -X POST http://localhost:3001/proxy/$APPKEY/some/route -H "Content-Type: application/json" -d '{"something":"to","say":true}'
```

TODOs
-----

#### User handling
There is currently no concept to verify a user, when he attempts to generate an application key and secret.
The plan is to provide a hook to add that with your favorite authentication service.

#### Built-in request forwarding
The `client` should forward the request if the user wants automatically.
This would remove the need to write your own forwarder.

#### Provide response to the server
The `server` currently happily accepts all incoming requests if the route contains a valid application key
and there is a client interested in those request. It then immediately sends 200.
It would be nicer if the client could signalize the server to finish the request with additional data and
status code.

