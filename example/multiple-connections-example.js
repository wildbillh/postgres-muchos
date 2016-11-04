

let PostgresMuchos = require('../lib/postgres-muchos');

let logger = (data) => {
    console.log(`log: ----------------------`);
    console.log(data);
};

let dbConfig = {
    user: 'nodejs-test',
    host: 'localhost',
    port: 5432,
    password: 'nodejs-test',
    database: 'nodejs-test',
};

let poolConfig = {
    max: 10, // maximum size of the pool
    min: 2, // minimum size of the pool
    idleTimeoutMillis: 5000,
    acquireTimeoutMillis: 1000,
    testOnBorrow: true,
    autostart: true
};

let emitControl = {
    connect: true,
    disconnect: true,
    query: true,
    results: true
};

let waitFunction = (timeout) => {
    return new Promise( (resolve, reject) => {
        setTimeout(() => {resolve();}, timeout);
    });

};


let db = new PostgresMuchos(dbConfig, poolConfig, emitControl);
//db.on('query', logger);
//db.on('results', logger);
db.on('connect', logger);
db.on('disconnect', logger);

db.close()
.then( () => {
    console.log('normal exit');
})
.catch ( (err) => {
   console.log(err);
});
