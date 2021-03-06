"use strict";

let GenericPool = require('generic-pool');
let pg = require ('pg');
let EventEmitter = require('events').EventEmitter;

/**
 *
 */
class PostgresMuchos extends EventEmitter {
    /**
     * @constructor
     * @param {object} dbConfig - The Database connection properties
     * @param {string} dbConfig.host
     * @param {string} dbConfig.user
     * @param {string} dbConfig.password
     * @param {number} [dbConfig.port=5432]
     * @param {string} [dbConfig.database]
     * @param {object} poolConfig - The pool configuration. See the [generic-pool]{@link https://github.com/coopernurse/node-pool} documentation
     * for more information.
     * @param {number} [poolConfig.min=0] Number of clients to start with
     * @param {number} [poolConfig.max=10] Max number of clients in the pool
     * @param {number} [poolConfig.idleTimout=30000] Number of milliseconds of inactivity before closing
     * @param {number} [poolConfig.acquireTimeoutMillis=1000] How long to keep trying to connect before giving up.
     * Note this is different then the generic-pool default of 0.
     * @param {object} [emitControl] Used to control which events are emitted.
     * @param {boolean} [emitControl.connect=false] Emit a <a href="#connect">connect</a> event with the process ID.
     * @param {boolean} [emitControl.disconnect=false] Emit a <a href="#disconnect">disconnect</a> event with the process ID.
     * @param {boolean} [emitControl.query=false] Emit a <a href="#query">query</a> event for all submitted sql.
     * @param {boolean} [emitControl.results=false] Emit a <a href="#results">results</a> event when results are available.
     * Also includes processID, query and elapsedTime (ms).
     */
    constructor (dbConfig, poolConfig, emitControl = {}) {
        super();
        let factory = this.createFactory(dbConfig);
        // Initialize the member variable. We add this to the returned
        // error message if there is an issue with the connection.
        this._onErrorMessage = null;
        this._emitControl = emitControl;
        this._FACTORY_CREATION_WAIT_PERIOD = 500;

        // Set the default value of acquireTimeoutMillis if not supplied.
        !poolConfig.acquireTimeoutMillis && (poolConfig.acquireTimeoutMillis = 1000);

        // create the pool
        this._pool = GenericPool.createPool(factory, poolConfig);

        // Listen for the factory create error event and store the value in a member variable
        this._pool.on('factoryCreateError', (err) => {
            err && (this._onErrorMessage = err);
        });
    }

    /**
     * Create the factory object needed by generic-pool
     * @example
     * // Added this so inch CI would be happy.
     * @private
     * @param {object} config Pool config object
     * @returns {{create: (function()), validate: (function(*)), destroy: (function(*=))}}
     */
    createFactory (config) {
        let that = this;
        return {
            /**
             * Creates the connection
             * @returns {Promise}
             */
            create: () => {
                return new Promise(function (resolve, reject) {
                    // get a new pg client
                    let client = new pg.Client(config);
                    // pg complains if you don't listen to the error response
                    client.on('error', () => {});
                    // connect to the client
                    client.connect((err) => {
                        if (err) {
                            return reject(err.message);
                        }
                        else {
                            // Emit a connect event if configured.
                            that._emitControl.connect && that.emit('connect', {event: 'connect', processID: client.processID});
                            return resolve(client);
                        }
                    })
                });
            },
            /**
             * Validates the connection based on select 1
             * @param {object} client
             * @returns {Promise}
             */
            validate: (client) => {
                return new Promise( (resolve, reject) => {
                    client.query('select 1', [], function(err, results) {
                        if (err) {
                            return reject(false);
                        }
                        return resolve(true);
                    });
                })
            },
            /**
             * Destroys the client
             * @param {object} client Acquired client
             * @returns {Promise}
             */
            destroy: (client) => {
                return new Promise(function(resolve, reject){
                    client.end( (err) => {
                        if (err) {
                            return reject(err);
                        }
                        // Emit an disconnect event if configured
                        that._emitControl.disconnect && that.emit('disconnect', {event: 'disconnect', processID: client.processID});
                        return resolve();
                    })
                })
            }
        };
    }

    /**
     * Wraps the pg client.query in a promise. Also emits events as configured
     * @param client
     * @param sql
     * @param parms
     * @returns {Promise}
     * @private
     */
    _query  (client, sql, parms) {
        let that = this;
        let start = new Date().getTime();
        return new Promise((resolve, reject) => {
            client.query(sql, parms, function (err, results) {
                if (err) {
                    return reject(err);
                }
                that._onErrorMessage = null;
                // if the query event is configured, emit it.
                that._emitControl.query && that.emit('query',
                    {event: 'query', sql: sql, parms: parms, processID: client.processID}
                );
                // if the results event is configured, emit it.
                if (that._emitControl.results) {
                    let elapsedTime = new Date().getTime() - start;
                    that.emit('results',
                        {event: 'results', elapsedTime: elapsedTime, sql: sql,
                        parms: parms, data: results.rows, processID: client.processID }
                    );

                }
                return resolve(results);
            });
        });
    }

    /**
     * Submit SQL or DDL to the database server. Returns a promise. The data structure of the
     * returned object is somewhat documented below.
     * @param sql {String} Valid SQL or DDL to apply to the DB
     * @param parms List of parameters to apply to the sql string
     * @fires PostgresMuchos#query
     * @fires PostgresMuchos#results
     * @returns {Promise} - On success, the promise will be resolved and a data object will be
     * returned. The promise will be rejected and an error message returned on error.
     * @returns {Object} results - The returned data object.
     * @returns {String} results.command - The type of query submitted: 'SELECT', 'UPDATE', etc.
     * @returns {Number} results.rowCount - The number of rows returned.
     * @returns {Array} results.fields - An Array of Objects describing the columns returned. Usefull
     * properties are name, columnID, format ... ect.
     * @returns {Array} results.rows - An Array of Objects equal to the size of rowCount above. Each
     * object contains properties matching the return column names.
     */
    query (sql, parms = []) {
        return new Promise((resolve, reject) => {
            let client = null;

            this._pool.acquire(0)
            .then ((clientParm) => {

                client = clientParm;
                return this._query(client, sql, parms);
            })
            .then( (results) => {
                this._pool.release(client).then();
                return resolve(results);
            })
            .catch( (err) => {
                this._pool && this._pool.release(client)
                .then(() => {
                })
                .catch( () => {
                });

                reject(`${err.message}: ${this._onErrorMessage ? this._onErrorMessage : ""}`);
                //console.log(this._onErrorMessage);
            });
        });
    }

    /**
     * Close all of the pool connections. No new connections can be opened.
     * @fires PostgresMuchos#disconnect
     * @returns {Promise}
     */
    close () {
        return new Promise( (resolve, reject) => {
            // check to see if there are pending creates. If so wait a little
            let timeout = 0;
            this._pool && this._pool._factoryCreateOperations && (this._pool._factoryCreateOperations.size > 0) && (timeout = this._FACTORY_CREATION_WAIT_PERIOD);
            this.waitFunction(timeout)
            .then ( () => {
                return this._pool.drain();
            })
            .then ( () => {
                return this._pool.clear();
            })
            .then ( () => {
                return resolve();
            })
            .catch( (err) => {
                return reject (err);
            })
        });
    }


    /**
     * Escape double quotes in the target string.
     * @param {string} source
     * @returns {string} the string with double quotes escaped
     */
    static escapeDoubleQuotes (source) {
        return (typeof source === 'string') ? source.replace(/"/g, '\\"') : source;
    }

    /**
     * Escape single quotes in the target string.
     * @param {string} source
     * @returns {string} the string with single quotes escaped.
     */
    static escapeSingleQuotes (source) {
        return (typeof source === 'string') ? source.replace(/'/g, "''") : source;
    }

    /**
     * Method to promisify the timeout function
     * @private
     * @param timeout
     * @returns {Promise}
     */
    waitFunction (timeout)  {
        return new Promise( (resolve, reject) => {
            setTimeout(() => {resolve();}, timeout);
        });


};

    /**
    * Exposes the underlying pool object. For advanced users only
    * @returns {Object} - The underlying pool object. See the documentation for any-db.
    */
    get pool () {
        return this._pool;
    }

    /**
     *  <div id="connect"/>
     * The connect event is emitted when a client is acquired from the pool.
     * @event PostgresMuchos#connect
     * @type {string}
     * @property {string} event Always contains the string 'connect'
     * @property {number} processID Contains the process ID of the acquired client.
     */

    /**
     * <div id="disconnect"/>
     * The disconnect event is emitted when a client is released from the pool.
     * @event PostgresMuchos#disconnect
     * @type {string}
     * @property {string} event Always contains the string 'disconnect'
     * @property {number} processID Contains the process ID to be closed.
     */

    /**
     * <div id="query"/>
     * The query event is emitted when the query method is called, but before the
     * submission to the db. The object emitted has the process ID of the client and the sql. This is often
     * useful for debugging purposes.
     * @event PostgresMuchos#query
     * @type {object}
     * @property {string} event Always contains the string 'query'.
     * @property {number} processID The process ID of the DB connection.
     * @property {string} sql The sql that was invoked.
     * @property {array} parms The paramters passed with the sql command.
     *
     *
     */

    /**
     * <div id="results"/>
     * The results event is emitted when the query method has resolved.
     * Configuring this event could slow processing slightly. For
     * performant applications, it should be turned off with emitControl.
     * @event PostgresMuchos#results
     * @type {object}
     * @property {string} event Always contains the string 'results'.
     * @property {number} elapsedTime The number of milliseconds between the invoke and results.
     * @property {string} sql The sql that was invoked.
     * @property {array} parms The parameters passed with the sql command.
     * @property {array} data The results.rows object returned.
     */

}

module.exports = PostgresMuchos;