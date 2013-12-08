callmydouble
============

Usage
-----

This project is npm based, so `npm install` gets you all the dependencies.

To start the publicly available beach head which dispatches incoming POSTs forward to the user's client:
```
./server.js
```

Back on your developer box, you have to start the listener, which opens a connection to the beach head server
and will dispatch public POSTs received by the *server* locally. Defaulting to http://localhost:3000.

```
./client.js listen -s <your public server URL>
```

From that point on you can test the flow
```
./client.js test /please/call/me/back -s <your public server URL>
```

Everything else is not yet implemented :D
