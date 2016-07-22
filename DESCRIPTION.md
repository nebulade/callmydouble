Ever needed a public webhook to catch callbacks from third party services, but you wanna react locally?

This module provides a simple server, which can be run on a publicly reachable servers, allowing clients to connect via socket.io from their developer box to the server. The client maintains a connection and will get notified if the public server was called on a user specific URL.

The server can maintain multiple such developer connections and give each of them a unique callback URL, which will get dispatched to their local client, where the developer is free to do whatever he wants with it.

The bundled client allows to generate application keys to identify the user and specify the unique URL. It further is an example on how to use the Listener in your application. The most common use case might be to just forward the incoming request locally to a node during development.