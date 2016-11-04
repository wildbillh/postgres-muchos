# PostgresMuchos
[![Inline docs](http://inch-ci.org/github/wildbillh/postgres-muchos.svg?branch=master)](http://inch-ci.org/github/wildbillh/postgres-muchos)[![npm version](https://badge.fury.io/js/postgres-muchos.svg)](https://badge.fury.io/js/postgres-muchos)
## Synopsis
PostgresMuchos is an ES6 class for managing a pool of postgresql connections.
All methods return native promises. This class utilizes the [node-postgres](https://github.com/brianc/node-postgres) and 
[node-pool](https://github.com/coopernurse/node-pool) modules internally.
__Note:__ The version of node-pool (generic-pool) included with pg is not used. 

## Installation
```sh
npm install postgres-muchos --save
```

## Documentation
See the JSDoc for extensive documentation.

### Instanciating the class. 
```javascript
let PostgresMuchos = require('postgres-muchos');
let db = new PostgresMuchos (dbConfig, poolConfig, <optional> emitControl);
```

The dbConfig object contains the database connection info: 
- `host`: `string` - The host to connect to
- `user`: `string` - user name
- `password`: `string` - password
- `port`: `number (optional = 5432)` - port number
- `database`: `string (optional)` - database
  
The poolConfig object determines the pool behavior. 
See the [node-pool](https://github.com/coopernurse/node-pool) documentation for the complete list. Here are some of the common properties: 
- `min`: `number (optional = 0) ` - The minimum number of connections to acquire.
- `max`: `number (optional = 10)` - The max number of connections to acquire.
- `idleTimeout`: `number (optional = 30000)` - The number of milliseconds of inactivity before reaping client. 
- `acquireTimeoutMillis`: `number (optional = 1000)` - How many milliseconds of unsuccessful connection attempts before giving up.

The emitControl object allows the user to determine which events the class fires. The default is to not fire any events. 
- `connect`: `boolean (optional = false) ` - Emit an event with every acquistion.
- `disconnect`: `boolean (optional = false) ` - Emit an event with every acquistion release.
- `query`: `boolean (optional = false) ` - Emit an event with every submission of a query.
- `resutls`: `boolean (optional = false) ` - Emit an event with every results return.

### Query the database
```javascript
db.query('select now() as thedate')
.then( (results) => {
    console.log(results.rows);
    // [ anonymous { thedate: 2016-11-04T18:12:50.634Z } ]
    return db.query('select $1::integer as thenumber', [100]);
})
.then ( (results) => {
    console.log(results.rows);
    // [ anonymous { thenumber: 100 } ]
    return db.close();
})
.then ( () => {
    console.log('normal exit');
})
.catch( (err) => {
    db.close.then();
    console.log(err);  
});
```

The query method returns a promise. If sql was sent, then the resolved promise contains a 
results object. The actual data is in the results.rows property which is an array of 
objects with the column names being the property names. 

### Destroy the pool
```javascript
db.close().then( () => {
    // it's closed
})
.catch( (err) -> {
    // probably closed already
});
```

### Events 
The class emits 4 different events. The contents of each event is an object. The motive behind providing
events was to ease in debugging. Multi-threaded appplications with database pools, can be difficult to debug. 
For normal processing, the events are not very useful. 
##### connect:
```javascript
{ event: 'connect', processID: 6872 }
```
##### disconnect:
```javascript
{ event: 'disconnect', processID: 6872 }
```
##### query:
```javascript
{ event: 'query',
  sql: 'select $1::integer as thenumber',
  parms: [ 100 ],
  processID: 6872 }
  ```
##### results:
```javascript
{ event: 'results',
  elapsedTime: 2,
  sql: 'select $1::integer as thenumber',
  parms: [ 100 ],
  data: [ anonymous { thenumber: 100 } ],
  processID: 6872 }
```









